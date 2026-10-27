import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { ModuleKey, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportsAccessService } from './reports-access.service';

describe('ReportsAccessService', () => {
  const prismaMock = {
    institution: { findUnique: jest.fn() },
    campus: { findMany: jest.fn() },
  };
  const moduleMock = { assertModuleEnabledForUser: jest.fn() };
  const campusMock = { getCampusIdsForUser: jest.fn() };
  const service = new ReportsAccessService(
    prismaMock as unknown as PrismaService,
    moduleMock as unknown as ModuleAccessService,
    campusMock as unknown as CampusAccessService,
  );

  const user = (
    role: UserRole,
    institutionId: string | null = 'inst-1',
  ): CurrentUser => ({
    sub: 'user-1',
    email: 'u@nexus.test',
    role,
    institutionId,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    moduleMock.assertModuleEnabledForUser.mockResolvedValue(undefined);
    campusMock.getCampusIdsForUser.mockResolvedValue(['c1', 'c2']);
    prismaMock.institution.findUnique.mockResolvedValue({
      timezone: 'Asia/Karachi',
    });
    prismaMock.campus.findMany.mockResolvedValue([
      { id: 'c1', name: 'Main', timezone: null },
      { id: 'c2', name: 'Dubai', timezone: 'Asia/Dubai' },
    ]);
  });

  it('gives an administrator their institution and the campuses they can see, with the campus timezone or the institution one', async () => {
    const scope = await service.resolve(user(UserRole.ADMIN));

    expect(moduleMock.assertModuleEnabledForUser).toHaveBeenCalledWith(
      expect.anything(),
      ModuleKey.REPORTING,
    );
    expect(scope).toEqual({
      institutionId: 'inst-1',
      campuses: [
        { id: 'c1', name: 'Main', timezone: 'Asia/Karachi' },
        { id: 'c2', name: 'Dubai', timezone: 'Asia/Dubai' },
      ],
    });
    expect(prismaMock.campus.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          institutionId: 'inst-1',
          deletedAt: null,
          id: { in: ['c1', 'c2'] },
        },
      }),
    );
  });

  it.each([UserRole.STAFF, UserRole.STUDENT, UserRole.GUARDIAN])(
    'refuses %s, because reports are for administrators',
    async (role) => {
      await expect(service.resolve(user(role))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(moduleMock.assertModuleEnabledForUser).not.toHaveBeenCalled();
    },
  );

  it('lets the superadmin view the institution they name, and asks for one when they do not', async () => {
    const scope = await service.resolve(user(UserRole.SUPERADMIN, null), {
      institutionId: 'inst-9',
    });

    expect(scope.institutionId).toBe('inst-9');
    await expect(
      service.resolve(user(UserRole.SUPERADMIN, null)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("ignores an institution an administrator asks for, so they cannot read another school's", async () => {
    const scope = await service.resolve(user(UserRole.ADMIN), {
      institutionId: 'inst-other',
    });

    expect(scope.institutionId).toBe('inst-1');
  });

  it('refuses an administrator whose institution lacks the reporting module', async () => {
    moduleMock.assertModuleEnabledForUser.mockRejectedValue(
      new ForbiddenException('reporting is not enabled'),
    );

    await expect(service.resolve(user(UserRole.ADMIN))).rejects.toThrow(
      'reporting is not enabled',
    );
  });

  it('narrows to one campus they may see, and refuses one they may not', async () => {
    prismaMock.campus.findMany.mockResolvedValue([
      { id: 'c2', name: 'Dubai', timezone: 'Asia/Dubai' },
    ]);
    const scope = await service.resolve(user(UserRole.ADMIN), {
      campusId: 'c2',
    });
    expect(scope.campuses.map((campus) => campus.id)).toEqual(['c2']);

    await expect(
      service.resolve(user(UserRole.ADMIN), { campusId: 'c9' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a campus that is not in the institution being viewed', async () => {
    prismaMock.campus.findMany.mockResolvedValue([]);

    await expect(
      service.resolve(user(UserRole.SUPERADMIN, null), {
        institutionId: 'inst-9',
        campusId: 'c1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('falls back to Karachi when no timezone is known', async () => {
    prismaMock.institution.findUnique.mockResolvedValue(null);
    prismaMock.campus.findMany.mockResolvedValue([
      { id: 'c1', name: 'Main', timezone: null },
    ]);

    const scope = await service.resolve(user(UserRole.ADMIN));

    expect(scope.campuses[0].timezone).toBe('Asia/Karachi');
  });
});
