import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ModuleKey,
  SubscriptionStatus,
  VoucherStatus,
} from '../../prisma/client';
import { AuditLogService } from '../../common/services/audit-log.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attendanceService: AttendanceService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Runs hourly rather than once at a fixed time because campuses set their
   * own staff/student end times — this catches each campus shortly after
   * its own cutoff instead of forcing one institution-wide moment. Re-runs
   * for an already-processed campus/day are cheap no-ops: markCampusAbsentees
   * only creates rows for users who don't already have one.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async runAutoAbsentJob() {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const campuses = await this.prisma.campus.findMany({
      where: { deletedAt: null, institutionId: { not: null } },
      select: {
        id: true,
        institutionId: true,
        staffEndTime: true,
        studentEndTime: true,
      },
    });

    const campusesByInstitution = new Map<string, typeof campuses>();
    for (const campus of campuses) {
      const institutionId = campus.institutionId;
      if (!institutionId) continue;
      const bucket = campusesByInstitution.get(institutionId) ?? [];
      bucket.push(campus);
      campusesByInstitution.set(institutionId, bucket);
    }

    let processedCount = 0;
    for (const [institutionId, institutionCampuses] of campusesByInstitution) {
      if (!(await this.isModuleEligible(institutionId, ModuleKey.ATTENDANCE))) {
        continue;
      }

      for (const campus of institutionCampuses) {
        const cutoff = this.resolveCutoff(
          today,
          campus.staffEndTime,
          campus.studentEndTime,
        );
        if (!cutoff || now < cutoff) continue;

        const result = await this.attendanceService.markCampusAbsentees(
          campus.id,
          today,
        );
        processedCount += 1;
        if (result.data.count > 0) {
          await this.auditLogService.log(null, {
            action: 'ATTENDANCE_AUTO_ABSENT',
            entity: 'Attendance',
            institutionId,
            metadata: {
              campusId: campus.id,
              date: today,
              markedCount: result.data.count,
            },
          });
        }
      }
    }

    this.logger.log(
      `Auto-absent job checked ${campuses.length} campus(es), processed ${processedCount} past cutoff for ${today}.`,
    );
  }

  /**
   * Daily voucher-overdue sweep. Only flips status (PENDING -> OVERDUE); no
   * late-fee policy exists yet to auto-apply an amount (lateFeeFine is
   * currently a manual accountant-entered field), so that half of the
   * original P0-3 scope is intentionally deferred — see PROGRESS.md.
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async runVoucherOverdueJob() {
    const startOfToday = new Date(
      new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z',
    );

    const candidates = await this.prisma.feeVoucher.findMany({
      where: {
        status: VoucherStatus.PENDING,
        dueDate: { lt: startOfToday },
        deletedAt: null,
      },
      select: {
        id: true,
        student: { select: { campus: { select: { institutionId: true } } } },
      },
    });

    if (candidates.length === 0) {
      this.logger.log('Voucher-overdue job found no candidates.');
      return;
    }

    const idsByInstitution = new Map<string | null, string[]>();
    for (const candidate of candidates) {
      const institutionId = candidate.student.campus?.institutionId ?? null;
      const ids = idsByInstitution.get(institutionId) ?? [];
      ids.push(candidate.id);
      idsByInstitution.set(institutionId, ids);
    }

    await this.prisma.feeVoucher.updateMany({
      where: { id: { in: candidates.map((item) => item.id) } },
      data: { status: VoucherStatus.OVERDUE },
    });

    for (const [institutionId, ids] of idsByInstitution) {
      await this.auditLogService.log(null, {
        action: 'FEE_VOUCHER_AUTO_OVERDUE',
        entity: 'FeeVoucher',
        institutionId,
        metadata: { voucherIds: ids, count: ids.length },
      });
    }

    this.logger.log(
      `Voucher-overdue job flipped ${candidates.length} voucher(s) to OVERDUE.`,
    );
  }

  /**
   * Daily subscription-lifecycle sweep: expired trials move to SUSPENDED so
   * the stored status matches reality for dashboards/listings. Runtime
   * access is already enforced independently by ModuleAccessService's own
   * endsAt check, so this job is a consistency/reporting fix, not the
   * primary enforcement mechanism.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async runSubscriptionLifecycleJob() {
    const now = new Date();
    const expiredTrials = await this.prisma.institutionSubscription.findMany({
      where: {
        status: SubscriptionStatus.TRIAL,
        endsAt: { lt: now },
        deletedAt: null,
      },
      select: { id: true, institutionId: true, endsAt: true },
    });

    if (expiredTrials.length === 0) {
      this.logger.log('Subscription-lifecycle job found no expired trials.');
      return;
    }

    await this.prisma.institutionSubscription.updateMany({
      where: { id: { in: expiredTrials.map((item) => item.id) } },
      data: { status: SubscriptionStatus.SUSPENDED },
    });

    for (const subscription of expiredTrials) {
      await this.auditLogService.log(null, {
        action: 'SUBSCRIPTION_AUTO_SUSPENDED',
        entity: 'InstitutionSubscription',
        entityId: subscription.id,
        institutionId: subscription.institutionId,
        metadata: {
          previousStatus: SubscriptionStatus.TRIAL,
          endsAt: subscription.endsAt,
        },
      });
    }

    this.logger.log(
      `Subscription-lifecycle job suspended ${expiredTrials.length} expired trial(s).`,
    );
  }

  private async isModuleEligible(institutionId: string, moduleKey: ModuleKey) {
    const runtimeConfig =
      await this.moduleAccessService.getInstitutionRuntimeConfig(institutionId);

    if (
      runtimeConfig.subscription &&
      (runtimeConfig.subscription.status === SubscriptionStatus.SUSPENDED ||
        runtimeConfig.subscription.status === SubscriptionStatus.CANCELLED)
    ) {
      return false;
    }

    if (
      runtimeConfig.subscription &&
      runtimeConfig.subscription.status === SubscriptionStatus.TRIAL &&
      runtimeConfig.subscription.endsAt &&
      runtimeConfig.subscription.endsAt.getTime() < Date.now()
    ) {
      return false;
    }

    return Boolean(runtimeConfig.modules[moduleKey]?.enabled);
  }

  private resolveCutoff(
    today: string,
    staffEndTime: string,
    studentEndTime: string,
  ) {
    const staffCutoff = this.parseTimeOnDate(today, staffEndTime);
    const studentCutoff = this.parseTimeOnDate(today, studentEndTime);
    if (!staffCutoff && !studentCutoff) return null;
    if (!staffCutoff) return studentCutoff;
    if (!studentCutoff) return staffCutoff;
    return staffCutoff > studentCutoff ? staffCutoff : studentCutoff;
  }

  private parseTimeOnDate(dateStr: string, time: string) {
    const match = /^(\d{2}):(\d{2})/.exec(time);
    if (!match) return null;
    return new Date(`${dateStr}T${match[1]}:${match[2]}:00.000Z`);
  }
}
