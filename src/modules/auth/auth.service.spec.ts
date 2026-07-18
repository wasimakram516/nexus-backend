import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import { UserRole, UserStatus } from '../../prisma/client';
// RegisterDto is typed against the hand-maintained domain enums, not the
// Prisma client enum — both share the same values, but TS enums are
// nominal, so DTO payload literals need this import.
import { UserRole as DtoUserRole } from '../../common/enums/domain.enums';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;

  const prismaMock = {
    user: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    refreshSession: {
      create: jest.fn(),
      updateMany: jest.fn(),
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
    clearCookie: jest.fn(),
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
          identifier: 'suspended@nexus.test',
          password: 'master-key-123456',
        },
        responseMock,
        {},
      ),
    ).rejects.toThrow(new UnauthorizedException('Your account is not active.'));
  });

  describe('login — failure audit trail', () => {
    it('audits an unknown identifier without leaking whether the account exists', async () => {
      prismaMock.user.findFirst.mockResolvedValue(null);

      await expect(
        service.login(
          { identifier: 'nobody@nexus.test', password: 'whatever' },
          responseMock,
          { ipAddress: '10.0.0.1', userAgent: 'jest' },
        ),
      ).rejects.toThrow(new UnauthorizedException('Invalid credentials.'));

      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: null,
          institutionId: null,
          action: 'AUTH_LOGIN_FAILED',
          entity: 'RefreshSession',
          metadata: {
            identifier: 'nobody@nexus.test',
            reason: 'INVALID_CREDENTIALS',
            ipAddress: '10.0.0.1',
            userAgent: 'jest',
          },
        },
      });
    });

    it('audits a suspended-account login attempt with the matched user id', async () => {
      prismaMock.user.findFirst.mockResolvedValue({
        id: 'user-1',
        email: 'suspended@nexus.test',
        passwordHash: 'hashed-password',
        role: UserRole.ADMIN,
        status: UserStatus.SUSPENDED,
        institutionId: 'institution-1',
      });

      await expect(
        service.login(
          { identifier: 'suspended@nexus.test', password: 'anything' },
          responseMock,
          { ipAddress: '10.0.0.2', userAgent: 'jest' },
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          institutionId: 'institution-1',
          action: 'AUTH_LOGIN_FAILED',
          entity: 'RefreshSession',
          metadata: {
            identifier: 'suspended@nexus.test',
            reason: 'ACCOUNT_INACTIVE',
            ipAddress: '10.0.0.2',
            userAgent: 'jest',
          },
        },
      });
    });

    it('audits a wrong-password attempt against a real, active account', async () => {
      prismaMock.user.findFirst.mockResolvedValue({
        id: 'user-1',
        email: 'admin@nexus.test',
        passwordHash: 'hashed-password',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        institutionId: 'institution-1',
      });

      await expect(
        service.login(
          { identifier: 'admin@nexus.test', password: 'wrong-password' },
          responseMock,
          { ipAddress: '10.0.0.3', userAgent: 'jest' },
        ),
      ).rejects.toThrow(new UnauthorizedException('Invalid credentials.'));

      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          institutionId: 'institution-1',
          action: 'AUTH_LOGIN_FAILED',
          entity: 'RefreshSession',
          metadata: {
            identifier: 'admin@nexus.test',
            reason: 'INVALID_CREDENTIALS',
            ipAddress: '10.0.0.3',
            userAgent: 'jest',
          },
        },
      });
    });
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
        identifier: 'admin@nexus.test',
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

  describe('register — admin-elevation rail', () => {
    const staffActor: CurrentUser = {
      sub: 'staff-1',
      email: 'staff@nexus.test',
      role: UserRole.STAFF,
      institutionId: 'institution-1',
    };
    const adminActor: CurrentUser = {
      sub: 'admin-1',
      email: 'admin@nexus.test',
      role: UserRole.ADMIN,
      institutionId: 'institution-1',
    };

    beforeEach(() => {
      prismaMock.user.findFirst.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue({
        id: 'new-user-1',
        name: 'New Staff',
        email: 'new@nexus.test',
        role: UserRole.STAFF,
        institutionId: 'institution-1',
      });
    });

    it('blocks a STAFF actor (delegated users.create grant) from creating an ADMIN account', async () => {
      await expect(
        service.register(
          {
            name: 'Sneaky',
            email: 'sneaky@nexus.test',
            password: 'password123',
            role: DtoUserRole.ADMIN,
          },
          staffActor,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });

    it('still blocks an ADMIN actor from creating another ADMIN account', async () => {
      await expect(
        service.register(
          {
            name: 'Sneaky Admin',
            email: 'sneaky2@nexus.test',
            password: 'password123',
            role: DtoUserRole.ADMIN,
          },
          adminActor,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });

    it('allows a STAFF actor to create a non-admin account scoped to their institution', async () => {
      await expect(
        service.register(
          {
            name: 'New Staff',
            email: 'new@nexus.test',
            password: 'password123',
            role: DtoUserRole.STAFF,
          },
          staffActor,
        ),
      ).resolves.toMatchObject({ message: 'User registered successfully' });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- untyped Prisma mock */
      expect(prismaMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ institutionId: 'institution-1' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('rejects a duplicate email regardless of actor', async () => {
      prismaMock.user.findFirst.mockResolvedValue({ id: 'existing-1' });

      await expect(
        service.register(
          {
            name: 'Dup',
            email: 'new@nexus.test',
            password: 'password123',
            role: DtoUserRole.STAFF,
          },
          staffActor,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('logout', () => {
    it('records the IP and user-agent on the logout audit entry', async () => {
      const currentUser: CurrentUser = {
        sub: 'user-1',
        email: 'admin@nexus.test',
        role: UserRole.ADMIN,
        institutionId: 'institution-1',
        sessionId: 'session-1',
      };
      prismaMock.refreshSession.updateMany.mockResolvedValue({ count: 1 });

      await service.logout(currentUser, responseMock, {
        ipAddress: '10.0.0.9',
        userAgent: 'jest',
      });

      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          action: 'AUTH_LOGOUT',
          entity: 'RefreshSession',
          entityId: 'session-1',
          metadata: {
            ipAddress: '10.0.0.9',
            userAgent: 'jest',
          },
        },
      });
    });
  });
});
