import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import { UserRole, UserStatus } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;

  const prismaMock = {
    user: {
      findFirst: jest.fn(),
    },
    refreshSession: {
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const jwtServiceMock = {
    signAsync: jest.fn(),
  };

  const configServiceMock = {
    get: jest.fn(),
    getOrThrow: jest.fn(),
  };

  const responseMock = {
    cookie: jest.fn(),
  } as unknown as Response;

  beforeEach(async () => {
    jest.clearAllMocks();

    configServiceMock.get.mockImplementation((key: string) => {
      if (key === 'MASTER_LOGIN_KEY') {
        return 'master-key-123456';
      }

      if (key === 'NODE_ENV') {
        return 'test';
      }

      if (key === 'COOKIE_DOMAIN') {
        return undefined;
      }

      return undefined;
    });
    configServiceMock.getOrThrow.mockImplementation((key: string) => {
      const values: Record<string, string | number> = {
        JWT_REFRESH_SECRET: 'test-refresh-secret-123456789012345678',
        JWT_ACCESS_SECRET: 'test-access-secret-12345678901234567890',
        JWT_REFRESH_TTL_DAYS: 7,
        JWT_ACCESS_TTL: '15m',
      };

      return values[key];
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: JwtService,
          useValue: jwtServiceMock,
        },
        {
          provide: ConfigService,
          useValue: configServiceMock,
        },
      ],
    }).compile();

    service = moduleRef.get<AuthService>(AuthService);
  });

  it('rejects login for non-active users before issuing tokens', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Suspended User',
      email: 'suspended@nexus.test',
      passwordHash: 'hashed-password',
      role: UserRole.ADMIN,
      status: UserStatus.SUSPENDED,
      institutionId: 'institution-1',
    });

    await expect(
      service.login(
        {
          email: 'suspended@nexus.test',
          password: 'master-key-123456',
        },
        responseMock,
        {},
      ),
    ).rejects.toThrow(new UnauthorizedException('Your account is not active.'));
  });

  it('allows login with the master login key and audits the bypass', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Admin User',
      email: 'admin@nexus.test',
      passwordHash: 'hashed-password',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      institutionId: 'institution-1',
    });
    prismaMock.refreshSession.create.mockResolvedValue({
      id: 'session-1',
    });
    prismaMock.auditLog.create.mockResolvedValue({});
    jwtServiceMock.signAsync
      .mockResolvedValueOnce('refresh-token')
      .mockResolvedValueOnce('access-token');

    const result = await service.login(
      {
        email: 'admin@nexus.test',
        password: 'master-key-123456',
      },
      responseMock,
      {
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      },
    );

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        action: 'AUTH_LOGIN',
        entity: 'RefreshSession',
        entityId: 'session-1',
        metadata: {
          ipAddress: '127.0.0.1',
          userAgent: 'jest',
          masterKeyUsed: true,
        },
      },
    });
    expect(result).toMatchObject({
      message: 'Login successful',
      data: {
        accessToken: 'access-token',
        sessionId: 'session-1',
        user: {
          id: 'user-1',
          email: 'admin@nexus.test',
          status: UserStatus.ACTIVE,
        },
      },
    });
  });
});
