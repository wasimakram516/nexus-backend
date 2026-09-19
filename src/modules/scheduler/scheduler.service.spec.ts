import { Test } from '@nestjs/testing';
import { Prisma, SubscriptionStatus, VoucherStatus } from '../../prisma/client';
import { AuditLogService } from '../../common/services/audit-log.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { TimezoneResolverService } from '../../common/services/timezone-resolver.service';
import { WorkingDayResolverService } from '../../common/services/working-day-resolver.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { SchedulerService } from './scheduler.service';

describe('SchedulerService', () => {
  let service: SchedulerService;

  const prismaMock = {
    campus: { findMany: jest.fn() },
    periodSlot: { findMany: jest.fn() },
    feeVoucher: { findMany: jest.fn(), updateMany: jest.fn() },
    institutionSubscription: { findMany: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const attendanceServiceMock = {
    markCampusAbsentees: jest.fn(),
    markPeriodAbsentees: jest.fn(),
    // Attendance dual mode (§ 5.3): defaults to DAILY so every pre-existing
    // test below (all written against the DAILY-mode job) keeps behaving
    // exactly as before without needing to know this call exists.
    resolveAttendanceMode: jest.fn().mockResolvedValue('DAILY'),
  };

  const moduleAccessServiceMock = {
    getInstitutionRuntimeConfig: jest.fn(),
  };

  const auditLogServiceMock = { log: jest.fn().mockResolvedValue(undefined) };

  // P0-7: every campus resolves to Asia/Karachi (UTC+5, no DST) unless a
  // test overrides it, and "today"/"the weekday" are computed the same way
  // TimezoneResolverService's real implementation would for a fixed UTC
  // system time of 2026-07-18T20:00:00.000Z -> 2026-07-19 01:00 local ->
  // still Saturday 2026-07-18 in Karachi only up to 19:00 UTC; at 20:00 UTC
  // local time is already 2026-07-19 01:00, i.e. Sunday. To keep this
  // suite's existing "Saturday" period-slot fixtures meaningful without
  // rewriting every date literal, the mock pins localDateString/
  // localDayOfWeek to the exact pre-P0-7 UTC-derived values instead of
  // reimplementing real Intl resolution — the *real* zone-correctness
  // behavior (local midnight vs UTC midnight, DST) is covered end-to-end by
  // timezone-resolver.service.spec.ts, not re-derived here.
  const timezoneResolverMock = {
    resolveForCampus: jest.fn().mockResolvedValue('Asia/Karachi'),
    localDateString: jest.fn().mockReturnValue('2026-07-18'),
    localDayOfWeek: jest.fn().mockReturnValue('SATURDAY'),
    zonedTimeToInstant: jest
      .fn()
      .mockImplementation((_tz: string, dateStr: string, time: string) => {
        const match = /^(\d{2}):(\d{2})/.exec(time);
        return match
          ? new Date(`${dateStr}T${match[1]}:${match[2]}:00.000Z`)
          : null;
      }),
  };

  const workingDayResolverMock = {
    isWorkingDay: jest.fn().mockResolvedValue(true),
  };

  const activeRuntimeConfig = {
    subscription: { status: SubscriptionStatus.ACTIVE, endsAt: null },
    modules: { ATTENDANCE: { enabled: true } },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-18T20:00:00.000Z'));
    timezoneResolverMock.resolveForCampus.mockResolvedValue('Asia/Karachi');
    timezoneResolverMock.localDateString.mockReturnValue('2026-07-18');
    timezoneResolverMock.localDayOfWeek.mockReturnValue('SATURDAY');
    timezoneResolverMock.zonedTimeToInstant.mockImplementation(
      (_tz: string, dateStr: string, time: string) => {
        const match = /^(\d{2}):(\d{2})/.exec(time);
        return match
          ? new Date(`${dateStr}T${match[1]}:${match[2]}:00.000Z`)
          : null;
      },
    );
    workingDayResolverMock.isWorkingDay.mockResolvedValue(true);

    const moduleRef = await Test.createTestingModule({
      providers: [
        SchedulerService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AttendanceService, useValue: attendanceServiceMock },
        { provide: ModuleAccessService, useValue: moduleAccessServiceMock },
        { provide: AuditLogService, useValue: auditLogServiceMock },
        { provide: TimezoneResolverService, useValue: timezoneResolverMock },
        {
          provide: WorkingDayResolverService,
          useValue: workingDayResolverMock,
        },
      ],
    }).compile();

    service = moduleRef.get<SchedulerService>(SchedulerService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('runAutoAbsentJob', () => {
    it('continues to later institutions when configuration and failure auditing both fail', async () => {
      prismaMock.campus.findMany.mockResolvedValue([
        {
          id: 'campus-1',
          institutionId: 'institution-1',
          staffEndTime: '17:00',
          studentEndTime: '15:00',
        },
        {
          id: 'campus-2',
          institutionId: 'institution-2',
          staffEndTime: '17:00',
          studentEndTime: '15:00',
        },
      ]);
      moduleAccessServiceMock.getInstitutionRuntimeConfig
        .mockRejectedValueOnce(new Error('Configuration unavailable'))
        .mockResolvedValue(activeRuntimeConfig);
      auditLogServiceMock.log.mockRejectedValueOnce(
        new Error('Audit unavailable'),
      );
      attendanceServiceMock.resolveAttendanceMode.mockResolvedValue('DAILY');
      attendanceServiceMock.markCampusAbsentees.mockResolvedValue({
        data: { count: 0 },
      });
      await expect(service.runAutoAbsentJob()).resolves.toBeUndefined();
      expect(attendanceServiceMock.markCampusAbsentees).toHaveBeenCalledTimes(
        1,
      );
      expect(attendanceServiceMock.markCampusAbsentees).toHaveBeenCalledWith(
        'campus-2',
        '2026-07-18',
      );
    });

    it('continues when an institution attendance mode cannot be resolved', async () => {
      prismaMock.campus.findMany.mockResolvedValue([
        {
          id: 'campus-1',
          institutionId: 'institution-1',
          staffEndTime: '17:00',
          studentEndTime: '15:00',
        },
        {
          id: 'campus-2',
          institutionId: 'institution-2',
          staffEndTime: '17:00',
          studentEndTime: '15:00',
        },
      ]);
      moduleAccessServiceMock.getInstitutionRuntimeConfig.mockResolvedValue(
        activeRuntimeConfig,
      );
      attendanceServiceMock.resolveAttendanceMode
        .mockRejectedValueOnce(new Error('Mode unavailable'))
        .mockResolvedValue('DAILY');
      attendanceServiceMock.markCampusAbsentees.mockResolvedValue({
        data: { count: 0 },
      });
      await service.runAutoAbsentJob();
      expect(attendanceServiceMock.markCampusAbsentees).toHaveBeenCalledWith(
        'campus-2',
        '2026-07-18',
      );
    });

    it('marks absentees for a campus whose cutoff has already passed, resolving timezone/date per campus', async () => {
      prismaMock.campus.findMany.mockResolvedValue([
        {
          id: 'campus-1',
          institutionId: 'institution-1',
          staffEndTime: '17:00',
          studentEndTime: '15:00',
        },
      ]);
      moduleAccessServiceMock.getInstitutionRuntimeConfig.mockResolvedValue(
        activeRuntimeConfig,
      );
      attendanceServiceMock.markCampusAbsentees.mockResolvedValue({
        message: 'Absent users marked successfully',
        data: { count: 3 },
      });

      await service.runAutoAbsentJob();

      expect(timezoneResolverMock.resolveForCampus).toHaveBeenCalledWith(
        'campus-1',
      );
      expect(attendanceServiceMock.markCampusAbsentees).toHaveBeenCalledWith(
        'campus-1',
        '2026-07-18',
      );
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          action: 'ATTENDANCE_AUTO_ABSENT',
          institutionId: 'institution-1',
        }),
      );
    });

    it('skips a campus whose cutoff has not passed yet', async () => {
      prismaMock.campus.findMany.mockResolvedValue([
        {
          id: 'campus-1',
          institutionId: 'institution-1',
          staffEndTime: '23:00',
          studentEndTime: '22:00',
        },
      ]);
      moduleAccessServiceMock.getInstitutionRuntimeConfig.mockResolvedValue(
        activeRuntimeConfig,
      );

      await service.runAutoAbsentJob();

      expect(attendanceServiceMock.markCampusAbsentees).not.toHaveBeenCalled();
    });

    it('skips every campus in an institution whose ATTENDANCE module is disabled', async () => {
      prismaMock.campus.findMany.mockResolvedValue([
        {
          id: 'campus-1',
          institutionId: 'institution-1',
          staffEndTime: '17:00',
          studentEndTime: '15:00',
        },
      ]);
      moduleAccessServiceMock.getInstitutionRuntimeConfig.mockResolvedValue({
        subscription: { status: SubscriptionStatus.ACTIVE, endsAt: null },
        modules: { ATTENDANCE: { enabled: false } },
      });

      await service.runAutoAbsentJob();

      expect(attendanceServiceMock.markCampusAbsentees).not.toHaveBeenCalled();
    });

    it('skips a suspended institution entirely', async () => {
      prismaMock.campus.findMany.mockResolvedValue([
        {
          id: 'campus-1',
          institutionId: 'institution-1',
          staffEndTime: '17:00',
          studentEndTime: '15:00',
        },
      ]);
      moduleAccessServiceMock.getInstitutionRuntimeConfig.mockResolvedValue({
        subscription: { status: SubscriptionStatus.SUSPENDED, endsAt: null },
        modules: { ATTENDANCE: { enabled: true } },
      });

      await service.runAutoAbsentJob();

      expect(attendanceServiceMock.markCampusAbsentees).not.toHaveBeenCalled();
    });

    it('skips an institution whose trial has already expired', async () => {
      prismaMock.campus.findMany.mockResolvedValue([
        {
          id: 'campus-1',
          institutionId: 'institution-1',
          staffEndTime: '17:00',
          studentEndTime: '15:00',
        },
      ]);
      moduleAccessServiceMock.getInstitutionRuntimeConfig.mockResolvedValue({
        subscription: {
          status: SubscriptionStatus.TRIAL,
          endsAt: new Date('2026-07-01T00:00:00.000Z'),
        },
        modules: { ATTENDANCE: { enabled: true } },
      });

      await service.runAutoAbsentJob();

      expect(attendanceServiceMock.markCampusAbsentees).not.toHaveBeenCalled();
    });

    it('does not write an audit entry when no new absentees were created (idempotent re-run)', async () => {
      prismaMock.campus.findMany.mockResolvedValue([
        {
          id: 'campus-1',
          institutionId: 'institution-1',
          staffEndTime: '17:00',
          studentEndTime: '15:00',
        },
      ]);
      moduleAccessServiceMock.getInstitutionRuntimeConfig.mockResolvedValue(
        activeRuntimeConfig,
      );
      attendanceServiceMock.markCampusAbsentees.mockResolvedValue({
        message: 'Absent users marked successfully',
        data: { count: 0 },
      });

      await service.runAutoAbsentJob();

      expect(attendanceServiceMock.markCampusAbsentees).toHaveBeenCalled();
      expect(auditLogServiceMock.log).not.toHaveBeenCalled();
    });

    it('branches to markPeriodAbsentees for due period slots in a PERIOD-mode institution, alongside (not instead of) the campus-wide staff sweep', async () => {
      // Mocked local time is 2026-07-18 (Saturday) per beforeEach.
      prismaMock.campus.findMany.mockResolvedValue([
        {
          id: 'campus-1',
          institutionId: 'institution-1',
          staffEndTime: '17:00',
          studentEndTime: '15:00',
        },
      ]);
      moduleAccessServiceMock.getInstitutionRuntimeConfig.mockResolvedValue(
        activeRuntimeConfig,
      );
      attendanceServiceMock.resolveAttendanceMode.mockResolvedValue('PERIOD');
      attendanceServiceMock.markCampusAbsentees.mockResolvedValue({
        message: 'Absent users marked successfully',
        data: { count: 1 },
      });
      prismaMock.periodSlot.findMany.mockResolvedValue([
        // Already ended (18:00 < 20:00 system time) — due.
        { id: 'period-1', endTime: '18:00' },
        // Not yet ended — not due this run.
        { id: 'period-2', endTime: '23:00' },
      ]);
      attendanceServiceMock.markPeriodAbsentees.mockResolvedValue({
        message: 'Absent students marked successfully',
        data: { count: 2 },
      });

      await service.runAutoAbsentJob();

      // Staff coverage (campus-wide sweep) is unaffected by PERIOD mode.
      expect(attendanceServiceMock.markCampusAbsentees).toHaveBeenCalledWith(
        'campus-1',
        '2026-07-18',
      );
      // Only the due period slot is swept.
      expect(attendanceServiceMock.markPeriodAbsentees).toHaveBeenCalledTimes(
        1,
      );
      expect(attendanceServiceMock.markPeriodAbsentees).toHaveBeenCalledWith(
        'period-1',
        '2026-07-18',
      );
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          action: 'ATTENDANCE_AUTO_ABSENT_PERIOD',
          institutionId: 'institution-1',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is intentionally typed `any` by @types/jest
          metadata: expect.objectContaining({ periodSlotId: 'period-1' }),
        }),
      );
    });

    it('keeps sweeping period slots and later campuses when a success audit write fails', async () => {
      prismaMock.campus.findMany.mockResolvedValue([
        {
          id: 'campus-1',
          institutionId: 'institution-1',
          staffEndTime: '17:00',
          studentEndTime: '15:00',
        },
        {
          id: 'campus-2',
          institutionId: 'institution-1',
          staffEndTime: '17:00',
          studentEndTime: '15:00',
        },
      ]);
      moduleAccessServiceMock.getInstitutionRuntimeConfig.mockResolvedValue(
        activeRuntimeConfig,
      );
      attendanceServiceMock.resolveAttendanceMode.mockResolvedValue('PERIOD');
      attendanceServiceMock.markCampusAbsentees.mockResolvedValue({
        data: { count: 1 },
      });
      prismaMock.periodSlot.findMany.mockResolvedValue([
        { id: 'period-1', endTime: '18:00' },
      ]);
      attendanceServiceMock.markPeriodAbsentees.mockResolvedValue({
        data: { count: 1 },
      });
      for (let call = 0; call < 4; call += 1) {
        auditLogServiceMock.log.mockRejectedValueOnce(
          new Error('Audit unavailable'),
        );
      }

      await expect(service.runAutoAbsentJob()).resolves.toBeUndefined();

      expect(attendanceServiceMock.markCampusAbsentees).toHaveBeenCalledTimes(
        2,
      );
      expect(attendanceServiceMock.markPeriodAbsentees).toHaveBeenCalledTimes(
        2,
      );
    });

    it('never queries period slots for a DAILY-mode institution', async () => {
      prismaMock.campus.findMany.mockResolvedValue([
        {
          id: 'campus-1',
          institutionId: 'institution-1',
          staffEndTime: '17:00',
          studentEndTime: '15:00',
        },
      ]);
      moduleAccessServiceMock.getInstitutionRuntimeConfig.mockResolvedValue(
        activeRuntimeConfig,
      );
      attendanceServiceMock.resolveAttendanceMode.mockResolvedValue('DAILY');
      attendanceServiceMock.markCampusAbsentees.mockResolvedValue({
        message: 'Absent users marked successfully',
        data: { count: 0 },
      });

      await service.runAutoAbsentJob();

      expect(prismaMock.periodSlot.findMany).not.toHaveBeenCalled();
      expect(attendanceServiceMock.markPeriodAbsentees).not.toHaveBeenCalled();
    });

    // P0-6 (§ 12 Verification 2): a due period landing on a closed date
    // must short-circuit to zero via the scheduler's own working-day gate.
    it('skips the entire period-slot loop on a closed date, in PERIOD mode', async () => {
      prismaMock.campus.findMany.mockResolvedValue([
        {
          id: 'campus-1',
          institutionId: 'institution-1',
          staffEndTime: '17:00',
          studentEndTime: '15:00',
        },
      ]);
      moduleAccessServiceMock.getInstitutionRuntimeConfig.mockResolvedValue(
        activeRuntimeConfig,
      );
      attendanceServiceMock.resolveAttendanceMode.mockResolvedValue('PERIOD');
      attendanceServiceMock.markCampusAbsentees.mockResolvedValue({
        message: 'Absent users marked successfully',
        data: { count: 0 },
      });
      workingDayResolverMock.isWorkingDay.mockResolvedValue(false);

      await service.runAutoAbsentJob();

      expect(workingDayResolverMock.isWorkingDay).toHaveBeenCalledWith(
        'institution-1',
        'campus-1',
        '2026-07-18',
        'SATURDAY',
      );
      expect(prismaMock.periodSlot.findMany).not.toHaveBeenCalled();
      expect(attendanceServiceMock.markPeriodAbsentees).not.toHaveBeenCalled();
    });

    // P0-9 (§ 7.4 / FOCUS-AREAS P0-9 Verification 3): one campus's failure
    // must not starve the rest of the sweep, and must be recorded without
    // personal data.
    it('isolates a failing campus so the next campus in the same institution still processes, and audits the failure without PII', async () => {
      prismaMock.campus.findMany.mockResolvedValue([
        {
          id: 'campus-broken',
          institutionId: 'institution-1',
          staffEndTime: '17:00',
          studentEndTime: '15:00',
        },
        {
          id: 'campus-ok',
          institutionId: 'institution-1',
          staffEndTime: '17:00',
          studentEndTime: '15:00',
        },
      ]);
      moduleAccessServiceMock.getInstitutionRuntimeConfig.mockResolvedValue(
        activeRuntimeConfig,
      );
      attendanceServiceMock.markCampusAbsentees.mockImplementation(
        (campusId: string) => {
          if (campusId === 'campus-broken') {
            throw new Error(
              'duplicate key value violates unique constraint "attendance_unique"',
            );
          }
          return Promise.resolve({
            message: 'Absent users marked successfully',
            data: { count: 1 },
          });
        },
      );

      await service.runAutoAbsentJob();

      expect(attendanceServiceMock.markCampusAbsentees).toHaveBeenCalledWith(
        'campus-ok',
        '2026-07-18',
      );
      // The metadata object's exact shape is asserted below (not wrapped in
      // objectContaining), which also proves no user name/email/id-shaped
      // PII field sneaks in — only campusId and a generic error string.
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          action: 'ATTENDANCE_AUTO_ABSENT_FAILED',
          institutionId: 'institution-1',
          metadata: {
            campusId: 'campus-broken',
            error:
              'duplicate key value violates unique constraint "attendance_unique"',
          },
        }),
      );
    });
  });

  describe('runVoucherOverdueJob', () => {
    it('flips still-eligible PENDING+overdue vouchers to OVERDUE and audits per institution', async () => {
      prismaMock.feeVoucher.findMany.mockResolvedValue([
        { id: 'voucher-1' },
        { id: 'voucher-2' },
      ]);

      const txFeeVoucher = {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'voucher-1',
            student: { campus: { institutionId: 'institution-1' } },
          },
          {
            id: 'voucher-2',
            student: { campus: { institutionId: 'institution-1' } },
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      };
      prismaMock.$transaction.mockImplementation(
        async (
          fn: (tx: { feeVoucher: typeof txFeeVoucher }) => Promise<unknown>,
        ) => fn({ feeVoucher: txFeeVoucher }),
      );

      await service.runVoucherOverdueJob();

      expect(prismaMock.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      expect(txFeeVoucher.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['voucher-1', 'voucher-2'] } },
        data: { status: VoucherStatus.OVERDUE },
      });
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          action: 'FEE_VOUCHER_AUTO_OVERDUE',
          institutionId: 'institution-1',
          metadata: { voucherIds: ['voucher-1', 'voucher-2'], count: 2 },
        }),
      );
    });

    it('does nothing when there are no overdue candidates', async () => {
      prismaMock.feeVoucher.findMany.mockResolvedValue([]);

      await service.runVoucherOverdueJob();

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(auditLogServiceMock.log).not.toHaveBeenCalled();
    });

    // P0-9 (§ 7.1 / FOCUS-AREAS P0-9 Verification 1): a voucher paid between
    // the outer selection and the transactional re-check must not be
    // flipped to OVERDUE, and must not be falsely audited.
    it('excludes a voucher paid between selection and the transactional re-check from both the update and the audit', async () => {
      prismaMock.feeVoucher.findMany.mockResolvedValue([
        { id: 'voucher-1' },
        { id: 'voucher-2' },
      ]);

      // Only voucher-2 is still eligible inside the transaction — voucher-1
      // was paid in the meantime, so the re-check's own WHERE excludes it.
      const txFeeVoucher = {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'voucher-2',
            student: { campus: { institutionId: 'institution-1' } },
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      };
      prismaMock.$transaction.mockImplementation(
        async (
          fn: (tx: { feeVoucher: typeof txFeeVoucher }) => Promise<unknown>,
        ) => fn({ feeVoucher: txFeeVoucher }),
      );

      await service.runVoucherOverdueJob();

      expect(txFeeVoucher.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['voucher-2'] } },
        data: { status: VoucherStatus.OVERDUE },
      });
      expect(auditLogServiceMock.log).toHaveBeenCalledTimes(1);
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          metadata: { voucherIds: ['voucher-2'], count: 1 },
        }),
      );
    });

    it('isolates a failing chunk without aborting the whole job, and audits the failure', async () => {
      prismaMock.feeVoucher.findMany.mockResolvedValue([{ id: 'voucher-1' }]);
      prismaMock.$transaction.mockRejectedValue(
        new Error('could not serialize access due to concurrent update'),
      );

      await expect(service.runVoucherOverdueJob()).resolves.not.toThrow();

      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          action: 'FEE_VOUCHER_AUTO_OVERDUE_FAILED',
        }),
      );
    });
  });

  describe('runSubscriptionLifecycleJob', () => {
    it('suspends still-eligible expired trials and audits each one', async () => {
      prismaMock.institutionSubscription.findMany.mockResolvedValue([
        { id: 'sub-1' },
      ]);

      const txSubscription = {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sub-1',
            institutionId: 'institution-1',
            endsAt: new Date('2026-07-01T00:00:00.000Z'),
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      };
      prismaMock.$transaction.mockImplementation(
        async (
          fn: (tx: {
            institutionSubscription: typeof txSubscription;
          }) => Promise<unknown>,
        ) => fn({ institutionSubscription: txSubscription }),
      );

      await service.runSubscriptionLifecycleJob();

      expect(txSubscription.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['sub-1'] } },
        data: { status: SubscriptionStatus.SUSPENDED },
      });
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          action: 'SUBSCRIPTION_AUTO_SUSPENDED',
          entityId: 'sub-1',
          institutionId: 'institution-1',
        }),
      );
    });

    it('does nothing when there are no expired trials', async () => {
      prismaMock.institutionSubscription.findMany.mockResolvedValue([]);

      await service.runSubscriptionLifecycleJob();

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(auditLogServiceMock.log).not.toHaveBeenCalled();
    });

    // P0-9 (§ 7.1 / FOCUS-AREAS P0-9 Verification 1): a subscription renewed
    // between selection and the transactional re-check must not be
    // suspended, and must not be falsely audited.
    it('excludes a subscription renewed between selection and the transactional re-check', async () => {
      prismaMock.institutionSubscription.findMany.mockResolvedValue([
        { id: 'sub-1' },
      ]);

      // Renewed in the meantime -> no longer TRIAL/expired -> the re-check's
      // own WHERE excludes it, so the transaction returns nothing eligible.
      const txSubscription = {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      };
      prismaMock.$transaction.mockImplementation(
        async (
          fn: (tx: {
            institutionSubscription: typeof txSubscription;
          }) => Promise<unknown>,
        ) => fn({ institutionSubscription: txSubscription }),
      );

      await service.runSubscriptionLifecycleJob();

      expect(txSubscription.updateMany).not.toHaveBeenCalled();
      expect(auditLogServiceMock.log).not.toHaveBeenCalled();
    });
  });
});
