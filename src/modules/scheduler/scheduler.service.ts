import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  DayOfWeek,
  ModuleKey,
  SubscriptionStatus,
  VoucherStatus,
} from '../../prisma/client';
import { AuditLogService } from '../../common/services/audit-log.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';

/** JS Date#getUTCDay() index (0 = Sunday) -> Prisma DayOfWeek. */
const DAY_OF_WEEK_BY_JS_INDEX: DayOfWeek[] = [
  DayOfWeek.SUNDAY,
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
];

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
   *
   * Attendance dual mode (§ 5.3, § 7.2, § 9, § 12 Track B Step 2): resolves
   * each institution's attendance mode alongside the existing module-
   * eligibility check. The campus-wide sweep (markCampusAbsentees) keeps
   * running for every campus regardless of mode — it's what covers STAFF
   * auto-absent, and staff attendance stays DAILY-only regardless of the
   * institution's setting (§ 9's design call), so it must not be skipped
   * for PERIOD-mode campuses. PERIOD-mode institutions additionally get a
   * per-PeriodSlot sweep (markPeriodAbsentees) for STUDENT coverage at
   * period granularity, once each due period's own endTime has passed —
   * independent of the campus-wide staff/student cutoff, since a period can
   * end hours before the campus's overall end-of-day time. Idempotent like
   * its campus-wide counterpart, so re-checking an already-past period each
   * hourly run is a cheap no-op.
   *
   * (Deliberate reading of the design doc's "instead of the single
   * campus-wide sweep" phrasing: read literally as a full replacement for
   * PERIOD-mode campuses, it would silently stop marking STAFF absentees
   * there too, contradicting the doc's own "staff stays DAILY regardless of
   * mode" design call. Keeping the campus-wide sweep unconditional and
   * adding the period sweep alongside it is the reading that actually
   * upholds that call — flagged per the task brief's own instruction to
   * note disagreements rather than silently implement a conflicting
   * literal reading.)
   */
  @Cron(CronExpression.EVERY_HOUR)
  async runAutoAbsentJob() {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const todayDayOfWeek = DAY_OF_WEEK_BY_JS_INDEX[now.getUTCDay()];
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
    let periodProcessedCount = 0;
    for (const [institutionId, institutionCampuses] of campusesByInstitution) {
      if (!(await this.isModuleEligible(institutionId, ModuleKey.ATTENDANCE))) {
        continue;
      }

      const mode =
        await this.attendanceService.resolveAttendanceMode(institutionId);

      for (const campus of institutionCampuses) {
        const cutoff = this.resolveCutoff(
          today,
          campus.staffEndTime,
          campus.studentEndTime,
        );
        if (cutoff && now >= cutoff) {
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

        if (mode !== 'PERIOD') continue;

        const duePeriods = await this.prisma.periodSlot.findMany({
          where: {
            campusId: campus.id,
            dayOfWeek: todayDayOfWeek,
            deletedAt: null,
          },
          select: { id: true, endTime: true },
        });

        for (const period of duePeriods) {
          const periodCutoff = this.parseTimeOnDate(today, period.endTime);
          if (!periodCutoff || now < periodCutoff) continue;

          const periodResult = await this.attendanceService.markPeriodAbsentees(
            period.id,
            today,
          );
          periodProcessedCount += 1;
          if (periodResult.data.count > 0) {
            await this.auditLogService.log(null, {
              action: 'ATTENDANCE_AUTO_ABSENT_PERIOD',
              entity: 'Attendance',
              institutionId,
              metadata: {
                campusId: campus.id,
                periodSlotId: period.id,
                date: today,
                markedCount: periodResult.data.count,
              },
            });
          }
        }
      }
    }

    this.logger.log(
      `Auto-absent job checked ${campuses.length} campus(es), processed ${processedCount} past cutoff and ${periodProcessedCount} due period slot(s) for ${today}.`,
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
