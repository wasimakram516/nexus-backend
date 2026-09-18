import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '../../prisma/client';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { UserPermissionsService } from '../../common/services/user-permissions.service';
import { InstitutionConfigService } from './institution-config.service';

describe('InstitutionConfigService', () => {
  let service: InstitutionConfigService;

  const moduleAccessServiceMock = {
    getInstitutionRuntimeConfig: jest.fn(),
  };
  const userPermissionsServiceMock = {
    getEffectivePermissionsForUser: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        InstitutionConfigService,
        { provide: ModuleAccessService, useValue: moduleAccessServiceMock },
        {
          provide: UserPermissionsService,
          useValue: userPermissionsServiceMock,
        },
      ],
    }).compile();

    service = moduleRef.get<InstitutionConfigService>(InstitutionConfigService);
  });

  it('rejects a caller with no institutionId', async () => {
    const user: CurrentUser = {
      sub: 'user-1',
      email: 'super@nexus.test',
      role: UserRole.SUPERADMIN,
      institutionId: null,
    };

    await expect(service.getMyRuntimeConfig(user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(
      moduleAccessServiceMock.getInstitutionRuntimeConfig,
    ).not.toHaveBeenCalled();
  });

  it('returns runtime config with effective permissions and the static permission catalog', async () => {
    const user: CurrentUser = {
      sub: 'user-1',
      email: 'staff@nexus.test',
      role: UserRole.STAFF,
      institutionId: 'institution-1',
    };
    moduleAccessServiceMock.getInstitutionRuntimeConfig.mockResolvedValue({
      plan: 'starter',
    });
    userPermissionsServiceMock.getEffectivePermissionsForUser.mockResolvedValue(
      { campuses: { read: true } },
    );

    const result = await service.getMyRuntimeConfig(user);

    expect(
      moduleAccessServiceMock.getInstitutionRuntimeConfig,
    ).toHaveBeenCalledWith('institution-1');
    expect(
      userPermissionsServiceMock.getEffectivePermissionsForUser,
    ).toHaveBeenCalledWith('user-1');
    expect(result).toMatchObject({
      message: 'Runtime configuration retrieved successfully',
      data: {
        plan: 'starter',
        permissions: { campuses: { read: true } },
      },
    });
    expect(Array.isArray(result.data.permissionCatalog)).toBe(true);
  });

  it('returns null permissions for an admin-level role (full access)', async () => {
    const user: CurrentUser = {
      sub: 'admin-1',
      email: 'admin@nexus.test',
      role: UserRole.ADMIN,
      institutionId: 'institution-1',
    };
    moduleAccessServiceMock.getInstitutionRuntimeConfig.mockResolvedValue({});
    userPermissionsServiceMock.getEffectivePermissionsForUser.mockResolvedValue(
      null,
    );

    const result = await service.getMyRuntimeConfig(user);

    expect(result.data.permissions).toBeNull();
  });
});
