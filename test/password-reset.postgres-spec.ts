import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { CurrentUser } from '../src/common/interfaces/current-user.interface';
import { RequestContextService } from '../src/common/services/request-context.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { UserRole } from '../src/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Real-database proof for password reset: the link works once even when it is
 * used twice at the same moment, expires, is replaced by a newer one, and
 * using it signs the person out everywhere. Run via `npm run test:postgres`.
 */
describe('PostgreSQL password reset', () => {
  const context = new RequestContextService();
  let prisma: PrismaService;
  let service: PasswordService;
  let userId: string;
  let email: string;
  const sent: Array<{ to: string; resetUrl: string }> = [];

  const tokenFromLastEmail = () =>
    new URL(sent[sent.length - 1].resetUrl).searchParams.get('token') as string;

  const passwordIs = async (password: string) =>
    bcrypt.compare(
      password,
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } }))
        .passwordHash,
    );

  const session = (revoked = false) =>
    prisma.refreshSession.create({
      data: {
        userId,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: revoked ? new Date() : null,
      },
    });

  const forget = () =>
    // The one-minute pause between requests is not what these tests prove.
    prisma.passwordResetToken.updateMany({
      where: { userId },
      data: { createdAt: new Date(Date.now() - 5 * 60_000) },
    });

  beforeAll(async () => {
    const connection = process.env.TEST_DATABASE_URL;
    if (!connection) throw new Error('TEST_DATABASE_URL is required');
    const url = new URL(connection);
    if (
      url.hostname !== '127.0.0.1' ||
      !/^\/nexus_audit_test(?:_[a-z0-9]+)?$/.test(url.pathname)
    )
      throw new Error('Use an isolated loopback nexus_audit_test database');
    process.env.DATABASE_URL = connection;
    prisma = new PrismaService(context);

    const notifications = {
      sendEmail: (_key: string, to: string, data: { resetUrl: string }) => {
        sent.push({ to, resetUrl: data.resetUrl });
        return Promise.resolve({ delivered: true });
      },
    } as unknown as NotificationsService;
    const config = {
      getOrThrow: () => 'https://nexus.example',
    } as unknown as ConfigService;
    service = new PasswordService(prisma, config, notifications);

    email = `${randomUUID()}@example.test`;
    userId = (
      await prisma.user.create({
        data: {
          name: 'Reset test',
          email,
          passwordHash: await bcrypt.hash('old-password', 4),
          role: 'STAFF',
          mustChangePassword: true,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('emails a link whose token is stored only as a hash', async () => {
    await service.requestReset(email.toUpperCase());

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(email);
    const stored = await prisma.passwordResetToken.findMany({
      where: { userId },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].tokenHash).not.toBe(tokenFromLastEmail());
    expect(stored[0].tokenHash).toHaveLength(64);
  });

  it('sends no second email to someone who asks again within the minute', async () => {
    await service.requestReset(email);

    expect(sent).toHaveLength(1);
    expect(await prisma.passwordResetToken.count({ where: { userId } })).toBe(
      1,
    );
  });

  it('a newer link replaces the older one, which then stops working', async () => {
    const older = tokenFromLastEmail();
    await forget();

    await service.requestReset(email);

    expect(sent).toHaveLength(2);
    await expect(service.reset(older, 'whatever-1')).rejects.toThrow(
      'invalid or has expired',
    );
    expect(await passwordIs('old-password')).toBe(true);
  });

  it('changes the password once, clears the must-change flag and signs out every session', async () => {
    const live = await session();
    const dead = await session(true);

    await service.reset(tokenFromLastEmail(), 'new-password-1');

    expect(await passwordIs('new-password-1')).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.mustChangePassword).toBe(false);
    const after = await prisma.refreshSession.findMany({
      where: { id: { in: [live.id, dead.id] } },
    });
    expect(after.every((row) => row.revokedAt !== null)).toBe(true);
    await expect(
      service.reset(tokenFromLastEmail(), 'another-pass-1'),
    ).rejects.toThrow('invalid or has expired');
    expect(await passwordIs('new-password-1')).toBe(true);
  });

  it('lets only one of two simultaneous uses of the same link win', async () => {
    await forget();
    await service.requestReset(email);
    const token = tokenFromLastEmail();

    const results = await Promise.allSettled([
      service.reset(token, 'racer-one-pass'),
      service.reset(token, 'racer-two-pass'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const winner = (await passwordIs('racer-one-pass'))
      ? 'racer-one-pass'
      : 'racer-two-pass';
    expect(await passwordIs(winner)).toBe(true);
  });

  it('refuses a link that has expired', async () => {
    await forget();
    await service.requestReset(email);
    await prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      service.reset(tokenFromLastEmail(), 'too-late-pass'),
    ).rejects.toThrow('invalid or has expired');
  });

  it('refuses a link when the account has been removed', async () => {
    const other = await prisma.user.create({
      data: {
        name: 'Gone',
        email: `${randomUUID()}@example.test`,
        passwordHash: await bcrypt.hash('x-password', 4),
        role: 'STAFF',
      },
    });
    const before = sent.length;
    await service.requestReset(other.email);
    expect(sent).toHaveLength(before + 1);
    const token = new URL(sent[sent.length - 1].resetUrl).searchParams.get(
      'token',
    ) as string;
    await prisma.user.update({
      where: { id: other.id },
      data: { status: 'SUSPENDED' },
    });

    await expect(service.reset(token, 'new-password-1')).rejects.toThrow(
      'invalid or has expired',
    );
  });

  it('changing your own password signs out the other sessions but keeps this one', async () => {
    const here = await session();
    const elsewhere = await session();
    const actor: CurrentUser = {
      sub: userId,
      email,
      role: UserRole.STAFF,
      institutionId: null,
      sessionId: here.id,
    };

    await service.change(actor, await currentPassword(), 'changed-pass-1');

    expect(await passwordIs('changed-pass-1')).toBe(true);
    const rows = await prisma.refreshSession.findMany({
      where: { id: { in: [here.id, elsewhere.id] } },
    });
    expect(rows.find((row) => row.id === here.id)?.revokedAt).toBeNull();
    expect(
      rows.find((row) => row.id === elsewhere.id)?.revokedAt,
    ).not.toBeNull();
    await expect(
      service.change(actor, 'wrong-current', 'changed-pass-2'),
    ).rejects.toThrow('Your current password is not correct.');
  });

  /** Whichever password the earlier tests left the account with. */
  async function currentPassword() {
    for (const candidate of ['racer-one-pass', 'racer-two-pass']) {
      if (await passwordIs(candidate)) return candidate;
    }
    throw new Error('The account has no password the tests know.');
  }
});
