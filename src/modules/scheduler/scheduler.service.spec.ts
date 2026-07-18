import { Test } from '@nestjs/testing';
import { SubscriptionStatus, VoucherStatus } from '../../prisma/client';
import { AuditLogService } from '../../common/services/audit-log.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { SchedulerService } from './scheduler.service';

describe('SchedulerService', () => {
  let service: SchedulerService;

  const prismaMock = {
    campus: { findMany: jest.fn() },
    feeVoucher: { findMany: jest.fn(), updateMany: jest.fn() },
    institutionSubscription: { findMany: jest.fn(), updateMany: jest.fn() },
  };

  const attendanceServiceMock = {
    markCampusAbsentees: jest.fn(),
  };

  const moduleAccessServiceMock = {
    getInstitutionRuntimeConfig: jest.fn(),
  };

  const auditLogServiceMock = { log: jest.fn().mockResolvedValue(undefined) };

  const activeRuntimeConfig = {
    subscription: { status: SubscriptionStatus.ACTIVE, endsAt: null },
    modules: { ATTENDANCE: { enabled: true } },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-18T20:00:00.000Z'));

    const moduleRef = await Test.createTestingModule({
      providers: [
        SchedulerService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AttendanceService, useValue: attendanceServiceMock },
        { provide: ModuleAccessService, useValue: moduleAccessServiceMock },
        { provide: AuditLogService, useValue: auditLogServiceMock },
      ],
    }).compile();

    service = moduleRef.get<SchedulerService>(SchedulerService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('runAutoAbsentJob', () => {
    it('marks absentees for a campus whose cutoff has already passed', async () => {
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
  });

  describe('runVoucherOverdueJob', () => {
    it('flips PENDING+overdue vouchers to OVERDUE and audits per institution', async () => {
      prismaMock.feeVoucher.findMany.mockResolvedValue([
        {
          id: 'voucher-1',
          student: { campus: { institutionId: 'institution-1' } },
        },
        {
          id: 'voucher-2',
          student: { campus: { institutionId: 'institution-1' } },
        },
      ]);

      await service.runVoucherOverdueJob();

      expect(prismaMock.feeVoucher.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['voucher-1', 'voucher-2'] } },
        data: { status: VoucherStatus.OVERDUE },
      });
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          action: 'FEE_VOUCHER_AUTO_OVERDUE',
          institutionId: 'institution-1',
        }),
      );
    });

    it('does nothing when there are no overdue candidates', async () => {
      prismaMock.feeVoucher.findMany.mockResolvedValue([]);

      await service.runVoucherOverdueJob();

      expect(prismaMock.feeVoucher.updateMany).not.toHaveBeenCalled();
      expect(auditLogServiceMock.log).not.toHaveBeenCalled();
    });
  });

  describe('runSubscriptionLifecycleJob', () => {
    it('suspends expired trials and audits each one', async () => {
      prismaMock.institutionSubscription.findMany.mockResolvedValue([
        {
          id: 'sub-1',
          institutionId: 'institution-1',
          endsAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ]);

      await service.runSubscriptionLifecycleJob();

      expect(
        prismaMock.institutionSubscription.updateMany,
      ).toHaveBeenCalledWith({
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

      expect(
        prismaMock.institutionSubscription.updateMany,
      ).not.toHaveBeenCalled();
      expect(auditLogServiceMock.log).not.toHaveBeenCalled();
    });
  });
});
