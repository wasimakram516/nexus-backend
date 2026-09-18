import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../prisma/client';
import { PermissionsGuard } from './permissions.guard';
import { UserPermissionsService } from '../services/user-permissions.service';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  const userPermissionsServiceMock = { can: jest.fn() };

  const makeContext = (user?: { role: UserRole; sub: string }) =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new PermissionsGuard(
      reflector,
      userPermissionsServiceMock as unknown as UserPermissionsService,
    );
  });

  it('allows the request when the route has no @RequirePermission metadata', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);

    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    expect(userPermissionsServiceMock.can).not.toHaveBeenCalled();
  });

  it('denies the request when no user is attached', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue({
      feature: 'campuses',
      action: 'read',
    });

    await expect(guard.canActivate(makeContext(undefined))).resolves.toBe(
      false,
    );
  });

  it('always allows SUPERADMIN without checking the permissions service', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue({
      feature: 'campuses',
      action: 'delete',
    });

    await expect(
      guard.canActivate(
        makeContext({ role: UserRole.SUPERADMIN, sub: 'super-1' }),
      ),
    ).resolves.toBe(true);
    expect(userPermissionsServiceMock.can).not.toHaveBeenCalled();
  });

  it('always allows institution ADMIN without checking the permissions service', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue({
      feature: 'campuses',
      action: 'delete',
    });

    await expect(
      guard.canActivate(makeContext({ role: UserRole.ADMIN, sub: 'admin-1' })),
    ).resolves.toBe(true);
    expect(userPermissionsServiceMock.can).not.toHaveBeenCalled();
  });

  it('allows a STAFF user when the permissions service grants the action', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue({
      feature: 'campuses',
      action: 'read',
    });
    userPermissionsServiceMock.can.mockResolvedValue(true);

    await expect(
      guard.canActivate(makeContext({ role: UserRole.STAFF, sub: 'staff-1' })),
    ).resolves.toBe(true);
  });

  it('throws ForbiddenException with a readable message when denied', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue({
      feature: 'salary_deduction_rule',
      action: 'delete',
    });
    userPermissionsServiceMock.can.mockResolvedValue(false);

    await expect(
      guard.canActivate(makeContext({ role: UserRole.STAFF, sub: 'staff-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
