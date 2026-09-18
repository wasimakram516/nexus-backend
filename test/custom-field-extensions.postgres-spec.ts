import { randomUUID } from 'node:crypto';
import { DayOfWeek } from '../src/prisma/client';
import { UserStatus } from '../src/common/enums/domain.enums';
import { PrismaService } from '../src/prisma/prisma.service';
import { RequestContextService } from '../src/common/services/request-context.service';
import { AuditLogService } from '../src/common/services/audit-log.service';
import { CampusAccessService } from '../src/common/services/campus-access.service';
import { EntityCustomFieldsService } from '../src/common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../src/common/services/module-access.service';
import { TimezoneResolverService } from '../src/common/services/timezone-resolver.service';
import { UserPermissionsService } from '../src/common/services/user-permissions.service';
import { WorkingDayResolverService } from '../src/common/services/working-day-resolver.service';
import { NoticesService } from '../src/modules/notices/notices.service';
import { TimetableService } from '../src/modules/timetable/timetable.service';
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import { UsersService } from '../src/modules/users/users.service';

/**
 * Shared-blocker item 2 (project-tracking/CUSTOM-FIELDS-ACCEPTANCE.md):
 * proves — against a real PostgreSQL database, not a mock — that an invalid
 * custom-field value during create/update never leaves a partially written
 * core record for the four newest custom-field extensions (Notices,
 * PeriodSlot, Attendance, User). The 23 previously registered entities
 * already have this proof in transactions.postgres-spec.ts; these four were
 * added afterward and had no equivalent coverage.
 *
 * Run via `npm run test:postgres` — see test/POSTGRES-TESTS.md.
 */
describe('PostgreSQL custom-field extension rollback (M4.5 shared blocker #2)', () => {
  const context = new RequestContextService();
  let prisma: PrismaService;
  let fields: EntityCustomFieldsService;
  let institutionId: string;
  let campusId: string;
  let sectionId: string;
  let classId: string;

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
    fields = new EntityCustomFieldsService(prisma, context);

    const institution = await prisma.institution.create({
      data: { name: 'Extension rollback test', slug: randomUUID() },
    });
    institutionId = institution.id;
    const campus = await prisma.campus.create({
      data: {
        institutionId,
        name: 'Extension campus',
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
    const level = await prisma.level.create({
      data: { name: 'Extension level', campusId },
    });
    const academicClass = await prisma.academicClass.create({
      data: { name: 'Extension class', levelId: level.id },
    });
    classId = academicClass.id;
    const section = await prisma.section.create({
      data: { name: 'Extension section', classId },
    });
    sectionId = section.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('rolls back a Notice when its required custom value is missing', async () => {
    const notices = new NoticesService(
      prisma,
      new AuditLogService(prisma),
      new CampusAccessService(prisma),
      fields,
      new ModuleAccessService(prisma),
    );
    const account = await prisma.user.create({
      data: {
        institutionId,
        name: 'Notice actor',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'SUPERADMIN',
      },
    });
    const actor = {
      sub: account.id,
      email: account.email,
      role: 'SUPERADMIN' as const,
      institutionId,
    };
    await prisma.customFieldDefinition.create({
      data: {
        institutionId,
        moduleKey: 'NOTICES',
        entityType: 'notice',
        fieldKey: 'priority',
        label: 'Priority',
        inputType: 'TEXT',
        isRequired: true,
      },
    });
    const auditsBefore = await prisma.auditLog.count({
      where: { institutionId },
    });

    await expect(
      notices.createNotice(institutionId, actor, {
        title: 'Rejected notice',
        body: 'Body',
      }),
    ).rejects.toThrow('Priority');
    expect(
      await prisma.notice.count({
        where: { institutionId, title: 'Rejected notice' },
      }),
    ).toBe(0);
    expect(await prisma.auditLog.count({ where: { institutionId } })).toBe(
      auditsBefore,
    );

    const created = await notices.createNotice(institutionId, actor, {
      title: 'Accepted notice',
      body: 'Body',
      customFields: { priority: 'High' },
    });
    expect(created.data).toMatchObject({
      title: 'Accepted notice',
      customFields: { priority: 'High' },
    });

    // Invalid (non-empty but wrong-typed) value on update must also roll
    // back the core field edit, not just block an empty required value.
    if (!created.data) throw new Error('Missing notice response');
    await prisma.customFieldDefinition.create({
      data: {
        institutionId,
        moduleKey: 'NOTICES',
        entityType: 'notice',
        fieldKey: 'pinned',
        label: 'Pinned',
        inputType: 'BOOLEAN',
      },
    });
    await expect(
      notices.updateNotice(institutionId, actor, created.data.id, {
        title: 'Changed title',
        customFields: { pinned: 'not-a-boolean' },
      }),
    ).rejects.toThrow('Pinned');
    // (updateNotice signature: institutionId, currentUser, id, dto — confirmed above)
    expect(
      await prisma.notice.findUnique({ where: { id: created.data.id } }),
    ).toMatchObject({ title: 'Accepted notice' });
  });

  it('rolls back a PeriodSlot when its required custom value is missing', async () => {
    const timetable = new TimetableService(
      prisma,
      new AuditLogService(prisma),
      new CampusAccessService(prisma),
      fields,
      new ModuleAccessService(prisma),
    );
    const account = await prisma.user.create({
      data: {
        institutionId,
        name: 'Timetable actor',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'SUPERADMIN',
      },
    });
    const actor = {
      sub: account.id,
      email: account.email,
      role: 'SUPERADMIN' as const,
      institutionId,
    };
    await prisma.customFieldDefinition.create({
      data: {
        institutionId,
        moduleKey: 'TIMETABLE',
        entityType: 'period_slot',
        fieldKey: 'room',
        label: 'Room',
        inputType: 'TEXT',
        isRequired: true,
      },
    });

    const request = {
      classId,
      sectionId,
      name: 'Period 1',
      periodNumber: 1,
      dayOfWeek: DayOfWeek.MONDAY,
      startTime: '08:00',
      endTime: '08:40',
    };
    await expect(timetable.createPeriodSlot(actor, request)).rejects.toThrow(
      'Room',
    );
    expect(
      await prisma.periodSlot.count({ where: { sectionId, periodNumber: 1 } }),
    ).toBe(0);

    const created = await timetable.createPeriodSlot(actor, {
      ...request,
      customFields: { room: 'Room 101' },
    });
    expect(created.data).toMatchObject({ customFields: { room: 'Room 101' } });

    if (!created.data) throw new Error('Missing period slot response');
    await expect(
      timetable.updatePeriodSlot(actor, created.data.id, {
        name: 'Changed name',
        customFields: { room: 42 },
      }),
    ).rejects.toThrow('Room');
    expect(
      await prisma.periodSlot.findUnique({ where: { id: created.data.id } }),
    ).toMatchObject({ name: 'Period 1' });
  });

  it('rolls back an Attendance check-in when its required custom value is missing', async () => {
    const timezoneResolver = new TimezoneResolverService(prisma);
    const workingDayResolver = new WorkingDayResolverService(prisma);
    const attendance = new AttendanceService(
      prisma,
      new CampusAccessService(prisma),
      fields,
      new ModuleAccessService(prisma),
      new UserPermissionsService(prisma),
      timezoneResolver,
      workingDayResolver,
    );
    const staffAccount = await prisma.user.create({
      data: {
        institutionId,
        name: 'Attendance subject',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'STAFF',
        status: 'ACTIVE',
      },
    });
    await prisma.userCampus.create({
      data: { userId: staffAccount.id, campusId },
    });
    const admin = await prisma.user.create({
      data: {
        institutionId,
        name: 'Attendance actor',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'SUPERADMIN',
      },
    });
    const actor = {
      sub: admin.id,
      email: admin.email,
      role: 'SUPERADMIN' as const,
      institutionId,
    };
    await prisma.customFieldDefinition.create({
      data: {
        institutionId,
        moduleKey: 'ATTENDANCE',
        entityType: 'attendance',
        fieldKey: 'device',
        label: 'Device',
        inputType: 'TEXT',
        isRequired: true,
      },
    });

    const request = {
      userId: staffAccount.id,
      date: '2026-09-17',
      checkIn: '2026-09-17T08:05:00.000Z',
    };
    await expect(attendance.checkIn(actor, request)).rejects.toThrow('Device');
    expect(
      await prisma.attendance.count({
        where: { userId: staffAccount.id, campusId },
      }),
    ).toBe(0);

    const created = await attendance.checkIn(actor, {
      ...request,
      customFields: { device: 'Biometric' },
    });
    expect(created.data).toMatchObject({
      customFields: { device: 'Biometric' },
    });
  });

  it('rolls back a User access update when a submitted custom value is invalid', async () => {
    const users = new UsersService(
      prisma,
      new AuditLogService(prisma),
      fields,
      context,
      new UserPermissionsService(prisma),
    );
    const admin = await prisma.user.create({
      data: {
        institutionId,
        name: 'User actor',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'SUPERADMIN',
      },
    });
    const target = await prisma.user.create({
      data: {
        institutionId,
        name: 'User target',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'STAFF',
        status: 'ACTIVE',
      },
    });
    const actor = {
      sub: admin.id,
      email: admin.email,
      role: 'SUPERADMIN' as const,
      institutionId,
    };
    await prisma.customFieldDefinition.create({
      data: {
        institutionId,
        moduleKey: 'PEOPLE',
        entityType: 'user',
        fieldKey: 'badgeNumber',
        label: 'Badge number',
        inputType: 'NUMBER',
      },
    });

    await expect(
      users.updateUserRole(actor, target.id, {
        status: UserStatus.SUSPENDED,
        customFields: { badgeNumber: 'not-a-number' },
      }),
    ).rejects.toThrow('Badge number');
    expect(
      await prisma.user.findUnique({ where: { id: target.id } }),
    ).toMatchObject({ status: 'ACTIVE' });

    const updated = await users.updateUserRole(actor, target.id, {
      status: UserStatus.SUSPENDED,
      customFields: { badgeNumber: 7 },
    });
    expect(updated.data).toMatchObject({
      status: UserStatus.SUSPENDED,
      customFields: { badgeNumber: 7 },
    });
  });
});
