import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { UserRole, UserStatus } from '../../../prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  const prismaMock = {
    user: { findUnique: jest.fn() },
    refreshSession: { findFirst: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('test-secret') },
        },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    strategy = moduleRef.get<JwtStrategy>(JwtStrategy);
  });

  const payload = {
    sub: 'user-1',
    email: 'user@nexus.test',
    role: UserRole.STAFF,
    institutionId: 'institution-1',
  };

  it('rejects a token for a user that no longer exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token for a soft-deleted user', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@nexus.test',
      role: UserRole.STAFF,
      status: UserStatus.ACTIVE,
      deletedAt: new Date(),
      institutionId: 'institution-1',
    });

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token for a non-ACTIVE user', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@nexus.test',
      role: UserRole.STAFF,
      status: UserStatus.SUSPENDED,
      deletedAt: null,
      institutionId: 'institution-1',
    });

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('resolves a valid user with no sessionId on the payload (no session check)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@nexus.test',
      role: UserRole.STAFF,
      status: UserStatus.ACTIVE,
      deletedAt: null,
      institutionId: 'institution-1',
    });

    const result = await strategy.validate(payload);

    expect(prismaMock.refreshSession.findFirst).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sub: 'user-1', sessionId: undefined });
  });

  it('rejects when the payload sessionId does not match an active refresh session', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@nexus.test',
      role: UserRole.STAFF,
      status: UserStatus.ACTIVE,
      deletedAt: null,
      institutionId: 'institution-1',
    });
    prismaMock.refreshSession.findFirst.mockResolvedValue(null);

    await expect(
      strategy.validate({ ...payload, sessionId: 'session-1' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('resolves a valid user with a matching active refresh session', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@nexus.test',
      role: UserRole.STAFF,
      status: UserStatus.ACTIVE,
      deletedAt: null,
      institutionId: 'institution-1',
    });
    prismaMock.refreshSession.findFirst.mockResolvedValue({
      id: 'session-1',
    });

    const result = await strategy.validate({
      ...payload,
      sessionId: 'session-1',
    });

    expect(result).toMatchObject({ sub: 'user-1', sessionId: 'session-1' });
  });
});
