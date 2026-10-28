/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- jest mock calls and asymmetric matchers are typed any */
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { UserRole, UserStatus } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PasswordService, RESET_LINK_MINUTES } from './password.service';

describe('PasswordService', () => {
  const sha = (value: string) =>
    createHash('sha256').update(value).digest('hex');

  const prismaMock = {
    user: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    passwordResetToken: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    refreshSession: { updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const notifications = { sendEmail: jest.fn() };
  const config = { getOrThrow: jest.fn() };
  const service = new PasswordService(
    prismaMock as unknown as PrismaService,
    config as unknown as ConfigService,
    notifications as unknown as NotificationsService,
  );

  const GENERIC =
    'If an account matches, a link to choose a new password has been sent to its email address.';
  const account = {
    id: 'user-1',
    name: 'Ayesha',
    email: 'ayesha@school.test',
    institution: { name: 'Greenfield School' },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    config.getOrThrow.mockReturnValue('https://nexus.example/');
    prismaMock.user.findFirst.mockResolvedValue(account);
    prismaMock.passwordResetToken.findFirst.mockResolvedValue(null);
    prismaMock.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.passwordResetToken.create.mockResolvedValue({});
    prismaMock.$transaction.mockImplementation((work: unknown) =>
      typeof work === 'function'
        ? (work as (client: typeof prismaMock) => Promise<unknown>)(prismaMock)
        : Promise.all(work as Promise<unknown>[]),
    );
    prismaMock.auditLog.create.mockResolvedValue({});
    notifications.sendEmail.mockResolvedValue({ delivered: true });
  });

  describe('requestReset', () => {
    it('stores only a hash of a fresh token, emails the link, and answers generically', async () => {
      const result = await service.requestReset(
        ' Ayesha@School.test ',
        '10.0.0.1',
      );

      expect(result).toEqual({ message: GENERIC, data: null });
      const stored = prismaMock.passwordResetToken.create.mock.calls[0][0].data;
      expect(stored.userId).toBe('user-1');
      expect(stored.requestedIp).toBe('10.0.0.1');
      expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + (RESET_LINK_MINUTES - 1) * 60_000,
      );

      const [, to, data] = notifications.sendEmail.mock.calls[0];
      expect(to).toBe('ayesha@school.test');
      const token = new URL(data.resetUrl).searchParams.get('token') as string;
      expect(
        data.resetUrl.startsWith('https://nexus.example/reset-password?token='),
      ).toBe(true);
      expect(sha(token)).toBe(stored.tokenHash);
      expect(token).not.toBe(stored.tokenHash);
      expect(data).toMatchObject({
        name: 'Ayesha',
        expiresInMinutes: RESET_LINK_MINUTES,
        institutionName: 'Greenfield School',
      });
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'PASSWORD_RESET_REQUESTED' }),
      });
    });

    it('looks the account up by email, registration number or phone, active accounts only', async () => {
      await service.requestReset('R-1');

      expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            status: UserStatus.ACTIVE,
            OR: [{ email: 'r-1' }, { identifier: { in: ['R-1'] } }],
          },
        }),
      );
    });

    it('finds a guardian by their phone however it is typed or was stored', async () => {
      await service.requestReset('0300 1234567');

      expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { email: '0300 1234567' },
              {
                identifier: {
                  in: ['0300 1234567', '+923001234567', '03001234567'],
                },
              },
            ],
          }) as never,
        }),
      );
    });

    it('invalidates earlier links so only the newest works', async () => {
      await service.requestReset('ayesha@school.test');

      expect(prismaMock.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', usedAt: null },
        data: { usedAt: expect.any(Date) },
      });
    });

    it('says the same thing and sends nothing when no account matches', async () => {
      prismaMock.user.findFirst.mockResolvedValue(null);

      await expect(service.requestReset('nobody@x.test')).resolves.toEqual({
        message: GENERIC,
        data: null,
      });
      expect(prismaMock.passwordResetToken.create).not.toHaveBeenCalled();
      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });

    it('does not send a second email to someone who asked a moment ago', async () => {
      prismaMock.passwordResetToken.findFirst.mockResolvedValue({ id: 't' });

      await expect(service.requestReset('ayesha@school.test')).resolves.toEqual(
        {
          message: GENERIC,
          data: null,
        },
      );
      expect(prismaMock.passwordResetToken.create).not.toHaveBeenCalled();
      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });

    it('still answers generically when the email could not be delivered, so the form leaks nothing', async () => {
      notifications.sendEmail.mockResolvedValue({
        delivered: false,
        error: 'mailbox unavailable',
      });

      await expect(service.requestReset('ayesha@school.test')).resolves.toEqual(
        {
          message: GENERIC,
          data: null,
        },
      );
    });

    it('leaves a platform administrator, who has no school, with no school name in the email', async () => {
      prismaMock.user.findFirst.mockResolvedValue({
        ...account,
        institution: null,
      });

      await service.requestReset('root@nexus.test');

      expect(
        notifications.sendEmail.mock.calls[0][2].institutionName,
      ).toBeNull();
    });
  });

  describe('reset', () => {
    const live = {
      id: 'tok-1',
      userId: 'user-1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      user: { id: 'user-1', status: UserStatus.ACTIVE, deletedAt: null },
    };

    beforeEach(() => {
      prismaMock.passwordResetToken.findUnique.mockResolvedValue(live);
      prismaMock.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.user.update.mockResolvedValue({});
      prismaMock.refreshSession.updateMany.mockResolvedValue({ count: 2 });
    });

    it('looks the token up by its hash, sets the new password, and signs the person out everywhere', async () => {
      const result = await service.reset('plain-token', 'new-password-1');

      expect(prismaMock.passwordResetToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tokenHash: sha('plain-token') } }),
      );
      const update = prismaMock.user.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 'user-1' });
      expect(
        await bcrypt.compare('new-password-1', update.data.passwordHash),
      ).toBe(true);
      expect(update.data.mustChangePassword).toBe(false);
      expect(prismaMock.refreshSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'PASSWORD_RESET_COMPLETED' }),
      });
      expect(result.message).toContain('Sign in with the new password');
    });

    it.each([
      ['unknown', null],
      ['already used', { ...live, usedAt: new Date() }],
      ['expired', { ...live, expiresAt: new Date(Date.now() - 1000) }],
      [
        'for a deleted account',
        { ...live, user: { ...live.user, deletedAt: new Date() } },
      ],
      [
        'for a suspended account',
        { ...live, user: { ...live.user, status: UserStatus.SUSPENDED } },
      ],
    ])('refuses a link that is %s, changing nothing', async (_name, record) => {
      prismaMock.passwordResetToken.findUnique.mockResolvedValue(record);

      await expect(service.reset('t', 'new-password-1')).rejects.toThrow(
        'This reset link is invalid or has expired. Ask for a new one.',
      );
      expect(prismaMock.user.update).not.toHaveBeenCalled();
      expect(prismaMock.refreshSession.updateMany).not.toHaveBeenCalled();
    });

    it('refuses the second of two uses of the same link at the same moment', async () => {
      prismaMock.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.reset('t', 'new-password-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });
  });

  describe('change', () => {
    const user: CurrentUser = {
      sub: 'user-1',
      email: 'a@x.test',
      role: UserRole.STAFF,
      institutionId: 'inst-1',
      sessionId: 'session-now',
    };

    beforeEach(async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        passwordHash: await bcrypt.hash('old-password', 4),
      });
      prismaMock.user.update.mockReturnValue(Promise.resolve({}));
      prismaMock.refreshSession.updateMany.mockReturnValue(
        Promise.resolve({ count: 1 }),
      );
    });

    it('sets the new password, clears the must-change flag, and signs out every other session but not this one', async () => {
      const result = await service.change(
        user,
        'old-password',
        'new-password-1',
      );

      const update = prismaMock.user.update.mock.calls[0][0];
      expect(
        await bcrypt.compare('new-password-1', update.data.passwordHash),
      ).toBe(true);
      expect(update.data.mustChangePassword).toBe(false);
      expect(prismaMock.refreshSession.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          revokedAt: null,
          id: { not: 'session-now' },
        },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result.message).toBe('Your password has been changed.');
    });

    it('signs out every session when the current one is not known', async () => {
      await service.change(
        { ...user, sessionId: undefined },
        'old-password',
        'new-password-1',
      );

      expect(prismaMock.refreshSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('refuses a wrong current password', async () => {
      await expect(
        service.change(user, 'not-it', 'new-password-1'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('refuses a new password that is the same as the old one', async () => {
      await expect(
        service.change(user, 'old-password', 'old-password'),
      ).rejects.toThrow('Choose a password different from the current one.');
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('refuses when the account no longer exists', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(
        service.change(user, 'old-password', 'new-password-1'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
