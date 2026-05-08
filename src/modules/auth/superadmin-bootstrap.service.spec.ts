import { ConfigService } from '@nestjs/config';
import { UserRole, UserStatus } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SuperadminBootstrapService } from './superadmin-bootstrap.service';

describe('SuperadminBootstrapService', () => {
  type SeedUserWriteArgs = {
    data: {
      name: string;
      email: string;
      passwordHash: string;
      role: UserRole;
      status: UserStatus;
      institutionId: null;
    };
    select: { id: true; email: true };
  };
  type SeededUserResult = {
    id: string;
    email: string;
  };

  const prismaMock = {
    user: {
      findFirst: jest.fn(),
      create: jest.fn<Promise<SeededUserResult>, [SeedUserWriteArgs]>(),
      update: jest.fn<
        Promise<SeededUserResult>,
        [{ where: { id: string } } & SeedUserWriteArgs]
      >(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const configServiceMock = {
    get: jest.fn(),
  };

  let service: SuperadminBootstrapService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SuperadminBootstrapService(
      prismaMock as unknown as PrismaService,
      configServiceMock as unknown as ConfigService,
    );
  });

  it('does nothing when superadmin seed env vars are not configured', async () => {
    configServiceMock.get.mockReturnValue(undefined);

    await service.onModuleInit();

    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('creates a seeded superadmin when one does not already exist', async () => {
    configServiceMock.get.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        SUPERADMIN_SEED_NAME: 'Root Admin',
        SUPERADMIN_SEED_EMAIL: 'root@nexus.test',
        SUPERADMIN_SEED_PASSWORD: 'password-123',
      };

      return values[key];
    });
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'root@nexus.test',
    });
    prismaMock.auditLog.create.mockResolvedValue({});

    await service.onModuleInit();

    const [createArgs] = prismaMock.user.create.mock.calls[0];

    expect(createArgs.select).toEqual({
      id: true,
      email: true,
    });
    expect(createArgs.data.name).toBe('Root Admin');
    expect(createArgs.data.email).toBe('root@nexus.test');
    expect(createArgs.data.role).toBe(UserRole.SUPERADMIN);
    expect(createArgs.data.status).toBe(UserStatus.ACTIVE);
    expect(createArgs.data.institutionId).toBeNull();
    expect(typeof createArgs.data.passwordHash).toBe('string');
    expect(createArgs.data.passwordHash).not.toBe('password-123');
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        action: 'SUPERADMIN_BOOTSTRAPPED',
        entity: 'User',
        entityId: 'user-1',
        metadata: {
          email: 'root@nexus.test',
          mode: 'created',
        },
      },
    });
  });

  it('updates the seeded superadmin when the email already exists', async () => {
    configServiceMock.get.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        SUPERADMIN_SEED_NAME: 'Root Admin',
        SUPERADMIN_SEED_EMAIL: 'root@nexus.test',
        SUPERADMIN_SEED_PASSWORD: 'password-123',
      };

      return values[key];
    });
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
    });
    prismaMock.user.update.mockResolvedValue({
      id: 'user-1',
      email: 'root@nexus.test',
    });
    prismaMock.auditLog.create.mockResolvedValue({});

    await service.onModuleInit();

    const [updateArgs] = prismaMock.user.update.mock.calls[0];

    expect(updateArgs.where).toEqual({ id: 'user-1' });
    expect(updateArgs.select).toEqual({
      id: true,
      email: true,
    });
    expect(updateArgs.data.name).toBe('Root Admin');
    expect(updateArgs.data.email).toBe('root@nexus.test');
    expect(updateArgs.data.role).toBe(UserRole.SUPERADMIN);
    expect(updateArgs.data.status).toBe(UserStatus.ACTIVE);
    expect(updateArgs.data.institutionId).toBeNull();
    expect(typeof updateArgs.data.passwordHash).toBe('string');
    expect(updateArgs.data.passwordHash).not.toBe('password-123');
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        action: 'SUPERADMIN_BOOTSTRAPPED',
        entity: 'User',
        entityId: 'user-1',
        metadata: {
          email: 'root@nexus.test',
          mode: 'updated',
        },
      },
    });
  });
});
