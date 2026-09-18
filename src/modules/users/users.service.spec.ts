import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, UserRole, UserStatus } from '../../prisma/client';
// DTOs (UpdateUserAccessDto etc.) are typed against the hand-maintained
// domain enums, not the Prisma client enum — both share the same values,
// but TS enums are nominal, so DTO payload literals need this import.
import {
  UserRole as DtoUserRole,
  UserStatus as DtoUserStatus,
} from '../../common/enums/domain.enums';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AuditLogService } from '../../common/services/audit-log.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { UserPermissionsService } from '../../common/services/user-permissions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;

  const adminUser: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'institution-1',
  };

  // A STAFF user reaching these methods at all implies PermissionsGuard
  // already confirmed a users.* grant on their assigned Role — these tests
  // exercise the service-layer rails that apply on top of that grant.
  const staffCaller: CurrentUser = {
    sub: 'staff-1',
    email: 'staff@nexus.test',
    role: UserRole.STAFF,
    institutionId: 'institution-1',
  };

  const staffTargetSameInstitution = {
    id: 'target-staff-1',
    role: UserRole.STAFF,
    status: UserStatus.ACTIVE,
    institutionId: 'institution-1',
    deletedAt: null,
  };

  const adminTargetSameInstitution = {
    id: 'target-admin-1',
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
    institutionId: 'institution-1',
    deletedAt: null,
  };

  const staffTargetOtherInstitution = {
    id: 'target-staff-2',
    role: UserRole.STAFF,
    status: UserStatus.ACTIVE,
    institutionId: 'institution-2',
    deletedAt: null,
  };

  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    role: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const auditLogServiceMock = { log: jest.fn().mockResolvedValue(undefined) };
  const requestContextMock = { runWith: jest.fn() };
  const userPermissionsServiceMock = {
    sanitizeOverrides: jest.fn((v: unknown) => v),
  };
  const entityCustomFieldsServiceMock = {
    saveRecord: jest
      .fn()
      .mockImplementation(
        (
          _params: unknown,
          mutation: (transaction: Prisma.TransactionClient) => Promise<unknown>,
        ) => mutation(prismaMock as unknown as Prisma.TransactionClient),
      ),
    attachToItem: jest
      .fn()
      .mockImplementation((item: unknown) => Promise.resolve(item)),
    attachToItems: jest
      .fn()
      .mockImplementation((items: unknown) => Promise.resolve(items)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditLogService, useValue: auditLogServiceMock },
        {
          provide: EntityCustomFieldsService,
          useValue: entityCustomFieldsServiceMock,
        },
        { provide: RequestContextService, useValue: requestContextMock },
        {
          provide: UserPermissionsService,
          useValue: userPermissionsServiceMock,
        },
      ],
    }).compile();

    service = moduleRef.get<UsersService>(UsersService);
  });

  describe('updateUserRole — delegated STAFF rail', () => {
    it('blocks a STAFF caller from updating a user in another institution', async () => {
      prismaMock.user.findUnique.mockResolvedValue(staffTargetOtherInstitution);

      await expect(
        service.updateUserRole(staffCaller, 'target-staff-2', {
          status: DtoUserStatus.SUSPENDED,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('blocks a STAFF caller from modifying an admin-level target in their own institution', async () => {
      prismaMock.user.findUnique.mockResolvedValue(adminTargetSameInstitution);

      await expect(
        service.updateUserRole(staffCaller, 'target-admin-1', {
          status: DtoUserStatus.SUSPENDED,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('blocks a STAFF caller from elevating a target to ADMIN', async () => {
      prismaMock.user.findUnique.mockResolvedValue(staffTargetSameInstitution);

      await expect(
        service.updateUserRole(staffCaller, 'target-staff-1', {
          role: DtoUserRole.ADMIN,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('allows a STAFF caller to update a same-institution, non-admin target', async () => {
      prismaMock.user.findUnique.mockResolvedValue(staffTargetSameInstitution);
      prismaMock.user.update.mockResolvedValue({
        ...staffTargetSameInstitution,
        status: UserStatus.SUSPENDED,
      });

      await expect(
        service.updateUserRole(staffCaller, 'target-staff-1', {
          status: DtoUserStatus.SUSPENDED,
        }),
      ).resolves.toMatchObject({ message: 'User updated successfully' });
      expect(prismaMock.user.update).toHaveBeenCalled();
    });
  });

  describe('updateUserRole — ADMIN behavior unchanged', () => {
    it('still allows ADMIN to update another ADMIN in the same institution', async () => {
      prismaMock.user.findUnique.mockResolvedValue(adminTargetSameInstitution);
      prismaMock.user.update.mockResolvedValue(adminTargetSameInstitution);

      await expect(
        service.updateUserRole(adminUser, 'target-admin-1', {
          status: DtoUserStatus.SUSPENDED,
        }),
      ).resolves.toMatchObject({ message: 'User updated successfully' });
    });

    it('still blocks ADMIN from updating a SUPERADMIN target', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        ...adminTargetSameInstitution,
        role: UserRole.SUPERADMIN,
      });

      await expect(
        service.updateUserRole(adminUser, 'target-admin-1', {
          status: DtoUserStatus.SUSPENDED,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects roleId/overrides on a resulting admin-level user', async () => {
      prismaMock.user.findUnique.mockResolvedValue(adminTargetSameInstitution);

      await expect(
        service.updateUserRole(adminUser, 'target-admin-1', {
          roleId: 'role-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('custom fields wiring (M4.5 / P1-2a)', () => {
    it('updateUserRole saves custom field values against the target institution', async () => {
      prismaMock.user.findUnique.mockResolvedValue(staffTargetSameInstitution);
      prismaMock.user.update.mockResolvedValue(staffTargetSameInstitution);

      await service.updateUserRole(adminUser, 'target-staff-1', {
        status: DtoUserStatus.SUSPENDED,
        customFields: { employeeId: 'EMP-042' },
      });

      expect(entityCustomFieldsServiceMock.saveRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          institutionId: 'institution-1',
          entityType: 'user',
          values: { employeeId: 'EMP-042' },
          create: false,
        }),
        expect.any(Function),
      );
    });

    it('skips custom-field wiring for a target with no institution context (e.g. SUPERADMIN)', async () => {
      const superadminCaller: CurrentUser = {
        sub: 'root-1',
        email: 'root@nexus.test',
        role: UserRole.SUPERADMIN,
        institutionId: null,
      };
      const superadminTarget = {
        id: 'target-root-1',
        role: UserRole.SUPERADMIN,
        status: UserStatus.ACTIVE,
        institutionId: null,
        deletedAt: null,
      };
      prismaMock.user.findUnique.mockResolvedValue(superadminTarget);
      prismaMock.user.update.mockResolvedValue(superadminTarget);

      await service.updateUserRole(superadminCaller, 'target-root-1', {
        status: DtoUserStatus.SUSPENDED,
      });

      expect(entityCustomFieldsServiceMock.saveRecord).not.toHaveBeenCalled();
      expect(prismaMock.user.update).toHaveBeenCalled();
    });
  });

  describe('deleteUser — delegated STAFF rail', () => {
    it('blocks a STAFF caller from deleting a user in another institution', async () => {
      prismaMock.user.findUnique.mockResolvedValue(staffTargetOtherInstitution);

      await expect(
        service.deleteUser(staffCaller, 'target-staff-2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('blocks a STAFF caller from deleting an admin-level target', async () => {
      prismaMock.user.findUnique.mockResolvedValue(adminTargetSameInstitution);

      await expect(
        service.deleteUser(staffCaller, 'target-admin-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('allows a STAFF caller to delete a same-institution, non-admin target', async () => {
      prismaMock.user.findUnique.mockResolvedValue(staffTargetSameInstitution);
      prismaMock.user.update.mockResolvedValue(staffTargetSameInstitution);

      await expect(
        service.deleteUser(staffCaller, 'target-staff-1'),
      ).resolves.toMatchObject({
        message: 'User moved to recycle bin successfully',
      });
    });
  });

  describe('listUsers — institution scoping', () => {
    it('scopes a STAFF caller to their own institution, same as ADMIN', async () => {
      prismaMock.$transaction.mockResolvedValue([[], 0]);

      await service.listUsers(staffCaller, { page: 1, limit: 10 });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped Prisma mock
      const [[findManyArgs]] = prismaMock.user.findMany.mock.calls;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- untyped Prisma mock
      expect(findManyArgs.where).toMatchObject({
        institutionId: 'institution-1',
      });
    });

    it('does not scope SUPERADMIN to any institution by default', async () => {
      prismaMock.$transaction.mockResolvedValue([[], 0]);
      const superadmin: CurrentUser = {
        sub: 'root',
        email: 'root@nexus.test',
        role: UserRole.SUPERADMIN,
      };

      await service.listUsers(superadmin, { page: 1, limit: 10 });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped Prisma mock
      const [[findManyArgs]] = prismaMock.user.findMany.mock.calls;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- untyped Prisma mock
      expect(findManyArgs.where).not.toHaveProperty('institutionId');
    });
  });

  describe('resolveUsers', () => {
    it('returns a name/email map keyed by id, scoped to the caller institution', async () => {
      prismaMock.user.findMany.mockResolvedValue([
        { id: 'user-1', name: 'Alice Admin', email: 'alice@nexus.test' },
      ]);

      const result = await service.resolveUsers(staffCaller, [
        'user-1',
        'user-2',
      ]);

      expect(prismaMock.user.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['user-1', 'user-2'] },
          institutionId: 'institution-1',
        },
        select: { id: true, name: true, email: true },
      });
      expect(result).toEqual({
        message: 'Users resolved successfully',
        data: { 'user-1': { name: 'Alice Admin', email: 'alice@nexus.test' } },
      });
    });

    it('does not scope SUPERADMIN to any institution', async () => {
      prismaMock.user.findMany.mockResolvedValue([]);
      const superadmin: CurrentUser = {
        sub: 'root',
        email: 'root@nexus.test',
        role: UserRole.SUPERADMIN,
      };

      await service.resolveUsers(superadmin, ['user-1']);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped Prisma mock
      const [[findManyArgs]] = prismaMock.user.findMany.mock.calls;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- untyped Prisma mock
      expect(findManyArgs.where).not.toHaveProperty('institutionId');
    });

    it('deduplicates ids and skips the query entirely when the list is empty', async () => {
      const result = await service.resolveUsers(staffCaller, []);

      expect(prismaMock.user.findMany).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: 'Users resolved successfully',
        data: {},
      });
    });
  });
});
