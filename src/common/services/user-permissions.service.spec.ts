import { Test } from '@nestjs/testing';
import { UserRole } from '../../prisma/client';
import { CurrentUser } from '../interfaces/current-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { UserPermissionsService } from './user-permissions.service';

describe('UserPermissionsService', () => {
  let service: UserPermissionsService;

  const prismaMock = {
    user: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        UserPermissionsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = moduleRef.get<UserPermissionsService>(UserPermissionsService);
  });

  describe('resolveEffectivePermissions', () => {
    it('grants STUDENT the self-service attendance:read default when no Role is assigned', () => {
      const map = service.resolveEffectivePermissions(
        UserRole.STUDENT,
        null,
        null,
      );

      expect(map.attendance.read).toBe(true);
      expect(map.attendance.update).toBe(false);
    });

    it('grants GUARDIAN the self-service attendance:read default when no Role is assigned', () => {
      const map = service.resolveEffectivePermissions(
        UserRole.GUARDIAN,
        null,
        null,
      );

      expect(map.attendance.read).toBe(true);
    });

    it('gives STAFF with no assigned Role zero access — no self-service default applies', () => {
      const map = service.resolveEffectivePermissions(
        UserRole.STAFF,
        null,
        null,
      );

      expect(map.attendance.read).toBe(false);
      expect(map.campuses.read).toBe(false);
    });

    it('uses the assigned Role permissions for a feature the Role explicitly sets', () => {
      const map = service.resolveEffectivePermissions(
        UserRole.STUDENT,
        { campuses: { read: true, create: false } },
        null,
      );

      expect(map.campuses.read).toBe(true);
      expect(map.campuses.create).toBe(false);
      // The Role's permissions object doesn't mention 'attendance' at all,
      // so that feature falls through to the STUDENT self-service default
      // rather than being zeroed out just because a Role is assigned.
      expect(map.attendance.read).toBe(true);
    });

    it('overlays an "allow" override on top of a false base value', () => {
      const map = service.resolveEffectivePermissions(
        UserRole.STAFF,
        { campuses: { read: false } },
        { campuses: { read: 'allow' } },
      );

      expect(map.campuses.read).toBe(true);
    });

    it('overlays a "deny" override on top of a true base value', () => {
      const map = service.resolveEffectivePermissions(UserRole.STUDENT, null, {
        attendance: { read: 'deny' },
      });

      expect(map.attendance.read).toBe(false);
    });

    it('ignores malformed (non-object) rolePermissions and overrides input', () => {
      const map = service.resolveEffectivePermissions(
        UserRole.STAFF,
        'not-an-object',
        ['also-invalid'],
      );

      expect(map.campuses.read).toBe(false);
    });
  });

  describe('getEffectivePermissionsForUser', () => {
    it('falls back to STUDENT self-service defaults when the user no longer exists', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const map = await service.getEffectivePermissionsForUser('ghost-user');

      expect(map?.attendance.read).toBe(true);
    });

    it('returns null (full access) for SUPERADMIN', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        role: UserRole.SUPERADMIN,
        permissionOverrides: null,
        assignedRole: null,
      });

      const map = await service.getEffectivePermissionsForUser('super-1');

      expect(map).toBeNull();
    });

    it('returns null (full access) for institution ADMIN', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        role: UserRole.ADMIN,
        permissionOverrides: null,
        assignedRole: null,
      });

      const map = await service.getEffectivePermissionsForUser('admin-1');

      expect(map).toBeNull();
    });

    it('uses the assigned Role permissions when the Role is not soft-deleted', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        role: UserRole.STAFF,
        permissionOverrides: null,
        assignedRole: {
          permissions: { campuses: { read: true } },
          deletedAt: null,
        },
      });

      const map = await service.getEffectivePermissionsForUser('staff-1');

      expect(map?.campuses.read).toBe(true);
    });

    it('ignores a soft-deleted assigned Role and falls back to no base permissions', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        role: UserRole.STAFF,
        permissionOverrides: null,
        assignedRole: {
          permissions: { campuses: { read: true } },
          deletedAt: new Date(),
        },
      });

      const map = await service.getEffectivePermissionsForUser('staff-1');

      expect(map?.campuses.read).toBe(false);
    });
  });

  describe('can', () => {
    const currentUser = (role: UserRole): CurrentUser => ({
      sub: 'user-1',
      email: 'user@nexus.test',
      role,
      institutionId: 'institution-1',
    });

    it('always allows SUPERADMIN without touching the database', async () => {
      const allowed = await service.can(
        currentUser(UserRole.SUPERADMIN),
        'campuses',
        'delete',
      );

      expect(allowed).toBe(true);
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });

    it('always allows institution ADMIN without touching the database', async () => {
      const allowed = await service.can(
        currentUser(UserRole.ADMIN),
        'campuses',
        'delete',
      );

      expect(allowed).toBe(true);
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });

    it('allows a STAFF user when the resolved map grants the action', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        role: UserRole.STAFF,
        permissionOverrides: null,
        assignedRole: {
          permissions: { campuses: { read: true } },
          deletedAt: null,
        },
      });

      const allowed = await service.can(
        currentUser(UserRole.STAFF),
        'campuses',
        'read',
      );

      expect(allowed).toBe(true);
    });

    it('denies a STAFF user when the resolved map does not grant the action', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        role: UserRole.STAFF,
        permissionOverrides: null,
        assignedRole: null,
      });

      const allowed = await service.can(
        currentUser(UserRole.STAFF),
        'campuses',
        'delete',
      );

      expect(allowed).toBe(false);
    });

    it('denies access to a feature key absent from the resolved map', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        role: UserRole.STAFF,
        permissionOverrides: null,
        assignedRole: null,
      });

      const allowed = await service.can(
        currentUser(UserRole.STAFF),
        'not_a_real_feature',
        'read',
      );

      expect(allowed).toBe(false);
    });
  });

  describe('sanitizeOverrides', () => {
    it('returns an empty object for non-object input', () => {
      expect(service.sanitizeOverrides(null)).toEqual({});
      expect(service.sanitizeOverrides('nope')).toEqual({});
      expect(service.sanitizeOverrides(['array'])).toEqual({});
    });

    it('drops unknown feature keys and unknown actions', () => {
      const result = service.sanitizeOverrides({
        not_a_feature: { read: 'allow' },
        campuses: { read: 'allow', frobnicate: 'allow' },
      });

      expect(result).toEqual({ campuses: { read: 'allow' } });
    });

    it('drops entries whose effect is not "allow"/"deny"', () => {
      const result = service.sanitizeOverrides({
        campuses: { read: 'maybe', create: 'allow' },
      });

      expect(result).toEqual({ campuses: { create: 'allow' } });
    });

    it('omits a feature entirely once all of its actions are stripped', () => {
      const result = service.sanitizeOverrides({
        campuses: { frobnicate: 'allow' },
      });

      expect(result).toEqual({});
    });

    it('skips non-object per-feature entries', () => {
      const result = service.sanitizeOverrides({
        campuses: 'not-an-object',
      });

      expect(result).toEqual({});
    });
  });

  describe('sanitizeRolePermissions', () => {
    it('returns an empty object for non-object input', () => {
      expect(service.sanitizeRolePermissions(undefined)).toEqual({});
      expect(service.sanitizeRolePermissions(42)).toEqual({});
    });

    it('keeps only boolean values for known feature/action pairs', () => {
      const result = service.sanitizeRolePermissions({
        campuses: { read: true, create: 'true', delete: false },
        bogus_feature: { read: true },
      });

      expect(result).toEqual({ campuses: { read: true, delete: false } });
    });

    it('skips non-object per-feature entries', () => {
      const result = service.sanitizeRolePermissions({
        campuses: ['not', 'an', 'object'],
      });

      expect(result).toEqual({});
    });
  });
});
