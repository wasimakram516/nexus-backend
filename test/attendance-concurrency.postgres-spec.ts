import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { RequestContextService } from '../src/common/services/request-context.service';
import { CampusAccessService } from '../src/common/services/campus-access.service';
import { EntityCustomFieldsService } from '../src/common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../src/common/services/module-access.service';
import { TimezoneResolverService } from '../src/common/services/timezone-resolver.service';
import { WorkingDayResolverService } from '../src/common/services/working-day-resolver.service';
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import { DayOfWeek, UserRole, UserStatus } from '../src/prisma/client';

/**
 * P0-9 Verification 2 (FOCUS-AREAS.md, mapped from § 7.3 /
 * § 12 of P0-6-7-9-CORRECTIVE-DESIGN.md): overlapping absence sweeps and
 * manual marks against a real, isolated PostgreSQL database — exercises the
 * actual unique-constraint + `createMany({ skipDuplicates: true })` path
 * that a mocked PrismaService can't meaningfully prove (a mock can't throw
 * the real P2002 collision `skipDuplicates` is meant to swallow).
 *
 * Run via `npm run test:postgres` against a disposable `nexus_audit_test`
 * database — see test/POSTGRES-TESTS.md.
 */
describe('PostgreSQL attendance concurrency (P0-9)', () => {
  const context = new RequestContextService();
  let prisma: PrismaService;
  let attendanceService: AttendanceService;
  let institutionId: string;
  let campusId: string;

  beforeAll(async () => {
    const connection = process.env.TEST_DATABASE_URL;
    if (!connection) throw new Error('TEST_DATABASE_URL is required');
    const url = new URL(connection);
    if (
      url.hostname !== '127.0.0.1' ||
      !/^\/nexus_audit_test(?:_[a-z0-9]+)?$/.test(url.pathname)
    )
      throw new Error('Use an isolated loopback nexus_audit_test database');
    process.env.DATABASE_URL = connection;
    prisma = new PrismaService(context);

    const timezoneResolver = new TimezoneResolverService(prisma);
    const workingDayResolver = new WorkingDayResolverService(prisma);
    const campusAccessService = {
      assertCampusAccess: () => Promise.resolve(undefined),
      getCampusIdsForUser: () => Promise.resolve([]),
    } as unknown as CampusAccessService;
    const moduleAccessService = {
      assertModuleEnabledForUser: () => Promise.resolve(undefined),
    } as unknown as ModuleAccessService;
    const entityCustomFieldsService = new EntityCustomFieldsService(
      prisma,
      context,
    );

    attendanceService = new AttendanceService(
      prisma,
      campusAccessService,
      entityCustomFieldsService,
      moduleAccessService,
      // UserPermissionsService is only used by request-driven endpoints
      // (checkIn/checkOut/bulkMark's actor checks), not by
      // markCampusAbsentees — unused here, so an empty stub is enough.
      {} as never,
      timezoneResolver,
      workingDayResolver,
    );

    const institution = await prisma.institution.create({
      data: {
        name: 'Attendance concurrency test',
        slug: randomUUID(),
        timezone: 'Asia/Karachi',
      },
    });
    institutionId = institution.id;

    const campus = await prisma.campus.create({
      data: {
        institutionId,
        name: 'Concurrency campus',
        location: 'Test',
        studentStartTime: '08:00',
        studentEndTime: '14:00',
        staffStartTime: '08:00',
        staffEndTime: '14:00',
        lateThreshold: 10,
        earlyLeaveThreshold: 10,
      },
    });
    campusId = campus.id;

    // Every weekday is a working day, so markCampusAbsentees never
    // short-circuits on the fail-closed default during this test.
    await prisma.institutionWorkingCalendar.create({
      data: {
        institutionId,
        workingDays: [
          DayOfWeek.SUNDAY,
          DayOfWeek.MONDAY,
          DayOfWeek.TUESDAY,
          DayOfWeek.WEDNESDAY,
          DayOfWeek.THURSDAY,
          DayOfWeek.FRIDAY,
          DayOfWeek.SATURDAY,
        ],
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('running markCampusAbsentees twice concurrently for the same campus/date produces exactly one row per staff member, no duplicate-key failure', async () => {
    const date = '2026-06-15';
    const users = await Promise.all(
      Array.from({ length: 5 }, async (_, index) => {
        const user = await prisma.user.create({
          data: {
            institutionId,
            name: `Concurrency Staff ${index}`,
            email: `${randomUUID()}@example.test`,
            passwordHash: 'unused-test-value',
            role: UserRole.STAFF,
            status: UserStatus.ACTIVE,
          },
        });
        await prisma.userCampus.create({
          data: { userId: user.id, campusId },
        });
        return user;
      }),
    );

    const [first, second] = await Promise.all([
      attendanceService.markCampusAbsentees(campusId, date),
      attendanceService.markCampusAbsentees(campusId, date),
    ]);

    // Neither call threw on the unique-constraint collision, and together
    // they created exactly one row per roster user — never more (no
    // duplicates) and never fewer (every user still got marked by one of
    // the two overlapping runs).
    expect(first.data.count + second.data.count).toBe(users.length);

    const rows = await prisma.attendance.findMany({
      where: {
        campusId,
        date: new Date(`${date}T00:00:00.000Z`),
        userId: { in: users.map((u) => u.id) },
      },
    });
    expect(rows).toHaveLength(users.length);
    const distinctUserIds = new Set(rows.map((row) => row.userId));
    expect(distinctUserIds.size).toBe(users.length);
  });

  it('a manual PRESENT mark that lands before a concurrent sweep is never overwritten by that sweep', async () => {
    // A dedicated campus, isolated from the previous test's 5-person
    // roster, so this campus's only candidate is the manually-marked user.
    const isolatedCampus = await prisma.campus.create({
      data: {
        institutionId,
        name: 'Manual-mark isolation campus',
        location: 'Test',
        studentStartTime: '08:00',
        studentEndTime: '14:00',
        staffStartTime: '08:00',
        staffEndTime: '14:00',
        lateThreshold: 10,
        earlyLeaveThreshold: 10,
      },
    });
    const date = '2026-06-16';
    const user = await prisma.user.create({
      data: {
        institutionId,
        name: 'Manually Marked Staff',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: UserRole.STAFF,
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.userCampus.create({
      data: { userId: user.id, campusId: isolatedCampus.id },
    });

    // Manual mark (equivalent of bulkMark()'s PRESENT upsert) lands first.
    await prisma.attendance.create({
      data: {
        userId: user.id,
        role: UserRole.STAFF,
        campusId: isolatedCampus.id,
        date: new Date(`${date}T00:00:00.000Z`),
        status: 'PRESENT',
      },
    });

    const result = await attendanceService.markCampusAbsentees(
      isolatedCampus.id,
      date,
    );

    // markCampusAbsentees only ever fills in *missing* rows — the existing
    // PRESENT row is excluded by the existingIds pre-filter and, even if a
    // race slipped a duplicate insert attempt through, skipDuplicates would
    // silently skip it rather than overwrite. Either way, the row must
    // still read PRESENT afterward.
    expect(result.data.count).toBe(0);
    const row = await prisma.attendance.findFirst({
      where: {
        userId: user.id,
        campusId: isolatedCampus.id,
        date: new Date(`${date}T00:00:00.000Z`),
      },
    });
    expect(row?.status).toBe('PRESENT');
  });
});
