import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../prisma/client';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;

  const makeContext = (user?: { role: UserRole }) =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new RolesGuard(reflector);
  });

  it('allows the request when the route declares no @Roles metadata', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);

    expect(guard.canActivate(makeContext())).toBe(true);
  });

  it('allows the request when the route declares an empty roles array', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([]);

    expect(guard.canActivate(makeContext())).toBe(true);
  });

  it('denies the request when no user is attached', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
      UserRole.ADMIN,
    ]);

    expect(guard.canActivate(makeContext(undefined))).toBe(false);
  });

  it('allows a user whose role is in the required list', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
      UserRole.ADMIN,
      UserRole.SUPERADMIN,
    ]);

    expect(guard.canActivate(makeContext({ role: UserRole.ADMIN }))).toBe(true);
  });

  it('denies a user whose role is not in the required list', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
      UserRole.ADMIN,
    ]);

    expect(guard.canActivate(makeContext({ role: UserRole.STAFF }))).toBe(
      false,
    );
  });
});
