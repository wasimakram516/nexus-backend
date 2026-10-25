/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest asymmetric matchers are typed any */
import { Test } from '@nestjs/testing';
import { Prisma, SubscriptionStatus, VoucherStatus } from '../../prisma/client';
import { AuditLogService } from '../../common/services/audit-log.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { TimezoneResolverService } from '../../common/services/timezone-resolver.service';
import { WorkingDayResolverService } from '../../common/services/working-day-resolver.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { StudentFineGenerationService } from '../finance/student-fine-generation.service';
import { previousMonthOf, SchedulerService } from './scheduler.service';

describe('SchedulerService', () => {
  let service: SchedulerService;

  const prismaMock = {
    campus: { findMany: jest.fn() },
    periodSlot: { findMany: jest.fn() },
    feeVoucher: { findMany: jest.fn(), updateMany: jest.fn() },
    institutionSubscription: { findMany: jest.fn(), updateMany: jest.fn() },
    institutionSetting: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };

  const fineGenerationMock = { generateAutomatically: jest.fn() };

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
        { provide: StudentFineGenerationService, useValue: fineGenerationMock },
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

  describe('previousMonthOf', () => {
    it.each([
      ['2026-11-01', { month: 10, year: 2026 }],
      ['2026-02-01', { month: 1, year: 2026 }],
      ['2026-01-01', { month: 12, year: 2025 }],
    ])('the month before %s', (today, expected) => {
      expect(previousMonthOf(today)).toEqual(expected);
    });
  });

  describe('runMonthlyFinesJob', () => {
    const financeConfig = {
      subscription: { status: SubscriptionStatus.ACTIVE, endsAt: null },
      modules: { FINANCE: { enabled: true } },
    };

    beforeEach(() => {
      prismaMock.campus.findMany.mockResolvedValue([
        { id: 'campus-1', institutionId: 'inst-1' },
        { id: 'campus-2', institutionId: 'inst-1' },
        { id: 'campus-3', institutionId: 'inst-2' },
      ]);
      moduleAccessServiceMock.getInstitutionRuntimeConfig.mockResolvedValue(
        financeConfig,
      );
      prismaMock.institutionSetting.findUnique.mockResolvedValue({
        value: { autoCalculateFines: true },
      });
      timezoneResolverMock.localDateString.mockReturnValue('2026-11-01');
      fineGenerationMock.generateAutomatically.mockResolvedValue({ data: {} });
    });

    it("calculates last month's fines for every campus of an institution that switched it on", async () => {
      await service.runMonthlyFinesJob();

      expect(fineGenerationMock.generateAutomatically).toHaveBeenCalledTimes(3);
      expect(fineGenerationMock.generateAutomatically).toHaveBeenCalledWith({
        campusId: 'campus-1',
        month: 10,
        year: 2026,
      });
      expect(fineGenerationMock.generateAutomatically).toHaveBeenCalledWith({
        campusId: 'campus-3',
        month: 10,
        year: 2026,
      });
    });

    it('rolls back over the new year using the campus local date', async () => {
      timezoneResolverMock.localDateString.mockReturnValue('2027-01-01');

      await service.runMonthlyFinesJob();

      expect(fineGenerationMock.generateAutomatically).toHaveBeenCalledWith(
        expect.objectContaining({ month: 12, year: 2026 }),
      );
    });

    it.each([
      ['has not switched it on', { value: { autoCalculateFines: false } }],
      ['has no finance setting at all', null],
      ['has an unusable setting', { value: 'nonsense' }],
    ])('does nothing for an institution that %s', async (_name, setting) => {
      prismaMock.institutionSetting.findUnique.mockResolvedValue(setting);

      await service.runMonthlyFinesJob();

      expect(fineGenerationMock.generateAutomatically).not.toHaveBeenCalled();
    });

    it('skips an institution whose finance module is off or whose subscription is suspended', async () => {
      moduleAccessServiceMock.getInstitutionRuntimeConfig
        .mockResolvedValueOnce({
          subscription: { status: SubscriptionStatus.ACTIVE, endsAt: null },
          modules: { FINANCE: { enabled: false } },
        })
        .mockResolvedValueOnce({
          subscription: { status: SubscriptionStatus.SUSPENDED, endsAt: null },
          modules: { FINANCE: { enabled: true } },
        });

      await service.runMonthlyFinesJob();

      expect(fineGenerationMock.generateAutomatically).not.toHaveBeenCalled();
      expect(prismaMock.institutionSetting.findUnique).not.toHaveBeenCalled();
    });

    it('records a failed campus and carries on with the rest', async () => {
      fineGenerationMock.generateAutomatically
        .mockRejectedValueOnce(
          new Error('Set the current academic year before calculating fines.'),
        )
        .mockResolvedValue({ data: {} });

      await service.runMonthlyFinesJob();

      expect(fineGenerationMock.generateAutomatically).toHaveBeenCalledTimes(3);
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          action: 'STUDENT_FINES_AUTO_FAILED',
          institutionId: 'inst-1',
          metadata: expect.objectContaining({ campusId: 'campus-1' }),
        }),
      );
    });

    it('records a failed institution check and still reaches the next institution', async () => {
      moduleAccessServiceMock.getInstitutionRuntimeConfig
        .mockRejectedValueOnce(new Error('Configuration unavailable'))
        .mockResolvedValue(financeConfig);

      await service.runMonthlyFinesJob();

      expect(fineGenerationMock.generateAutomatically).toHaveBeenCalledTimes(1);
      expect(fineGenerationMock.generateAutomatically).toHaveBeenCalledWith(
        expect.objectContaining({ campusId: 'campus-3' }),
      );
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          action: 'STUDENT_FINES_AUTO_FAILED',
          institutionId: 'inst-1',
        }),
      );
    });

    it('still finishes when even the failure audit cannot be written', async () => {
      fineGenerationMock.generateAutomatically.mockRejectedValue(
        new Error('boom'),
      );
      auditLogServiceMock.log.mockRejectedValue(new Error('audit down'));

      await expect(service.runMonthlyFinesJob()).resolves.toBeUndefined();
    });
  });
});
