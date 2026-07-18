import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../prisma/client';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AuditLogService } from '../../common/services/audit-log.service';
import { UserPermissionsService } from '../../common/services/user-permissions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RolesService } from './roles.service';

describe('RolesService', () => {
  let service: RolesService;

  const adminUser: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: 'ADMIN',
    institutionId: 'institution-1',
  };

  const role = {
    id: 'role-1',
    institutionId: 'institution-1',
    name: 'Front Desk',
    description: 'Read-only front desk staff',
    permissions: { students: { read: true } },
  };

  const prismaMock = {
    institution: {
      findUnique: jest.fn().mockResolvedValue({ id: 'institution-1' }),
    },
    role: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  const auditLogServiceMock = {
    log: jest.fn().mockResolvedValue(undefined),
  };

  const userPermissionsService = new UserPermissionsService(
    prismaMock as never,
  );

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditLogService, useValue: auditLogServiceMock },
        { provide: UserPermissionsService, useValue: userPermissionsService },
      ],
    }).compile();

    service = moduleRef.get<RolesService>(RolesService);
  });

  describe('createRole', () => {
    it('sanitizes unknown feature keys and actions before persisting', async () => {
      prismaMock.role.create.mockResolvedValue(role);

      await service.createRole(
        'institution-1',
        {
          name: 'Front Desk',
          permissions: {
            students: { read: true, launch_missiles: true },
            not_a_real_feature: { read: true },
          },
        },
        adminUser,
      );

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- untyped Prisma mock */
      expect(prismaMock.role.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            institutionId: 'institution-1',
            name: 'Front Desk',
            permissions: { students: { read: true } },
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({ action: 'ROLE_CREATED' }),
      );
    });

    it('throws NotFoundException when the institution does not exist', async () => {
      prismaMock.institution.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.createRole(
          'institution-missing',
          { name: 'X', permissions: {} },
          adminUser,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('translates a unique-constraint violation into a ConflictException', async () => {
      prismaMock.role.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.createRole(
          'institution-1',
          { name: 'Front Desk', permissions: {} },
          adminUser,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('listRoles / getRole', () => {
    it('lists roles for the institution', async () => {
      prismaMock.role.findMany.mockResolvedValue([role]);

      await expect(service.listRoles('institution-1')).resolves.toMatchObject({
        data: [role],
      });
    });

    it('throws NotFoundException when the role does not exist in scope', async () => {
      prismaMock.role.findFirst.mockResolvedValue(null);

      await expect(
        service.getRole('institution-1', 'missing-role'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateRole', () => {
    it('re-sanitizes permissions on update', async () => {
      prismaMock.role.findFirst.mockResolvedValue(role);
      prismaMock.role.update.mockResolvedValue({
        ...role,
        permissions: { students: { read: true, update: true } },
      });

      await service.updateRole(
        'institution-1',
        'role-1',
        { permissions: { students: { read: true, update: true, hack: true } } },
        adminUser,
      );

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- untyped Prisma mock */
      expect(prismaMock.role.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'role-1' },
          data: expect.objectContaining({
            permissions: { students: { read: true, update: true } },
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
  });

  describe('deleteRole', () => {
    it('soft-deletes and audit-logs the role', async () => {
      prismaMock.role.findFirst.mockResolvedValue(role);
      prismaMock.role.update.mockResolvedValue(role);

      await expect(
        service.deleteRole('institution-1', 'role-1', adminUser, 'cleanup'),
      ).resolves.toMatchObject({ data: { id: 'role-1' } });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- untyped Prisma mock */
      expect(prismaMock.role.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'role-1' },
          data: expect.objectContaining({
            deletedBy: adminUser.sub,
            deleteReason: 'cleanup',
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
  });
});
