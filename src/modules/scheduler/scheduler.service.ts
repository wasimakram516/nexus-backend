import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ModuleKey,
  Prisma,
  SubscriptionStatus,
  VoucherStatus,
} from '../../prisma/client';
import { AuditLogService } from '../../common/services/audit-log.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { TimezoneResolverService } from '../../common/services/timezone-resolver.service';
import { WorkingDayResolverService } from '../../common/services/working-day-resolver.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';

/** P0-9 (§ 7.1's batching note): chunk size for the transactional
 *  re-check-then-update sweeps, keeping each transaction's duration and
 *  lock footprint bounded rather than holding one Serializable transaction
 *  open across thousands of candidate rows. */
const RECHECK_CHUNK_SIZE = 200;

/** Splits `items` into chunks of at most `size` — used to bound each
 *  re-check transaction's candidate set (§ 7.1). */
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attendanceService: AttendanceService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly auditLogService: AuditLogService,
    private readonly timezoneResolver: TimezoneResolverService,
    private readonly workingDayResolver: WorkingDayResolverService,
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
   * P0-7 (§ 4.1): every date/weekday/cutoff computation below is resolved
   * per-campus in that campus's own local timezone (TimezoneResolverService)
   * instead of the server's UTC clock — "today" and "the cutoff instant"
   * can differ between two campuses running in this same loop iteration.
   *
   * P0-9 (§ 7.4): each campus's unit of work is wrapped in its own
   * try/catch so one campus's failure (e.g. a bad cutoff string, a
   * transient DB error) never starves the rest of the sweep. Failures are
   * logged and recorded via an ATTENDANCE_AUTO_ABSENT_FAILED audit entry
   * carrying only campusId/date/a generic error message — never user PII.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async runAutoAbsentJob() {
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
    const failedCampusIds: string[] = [];

    for (const [institutionId, institutionCampuses] of campusesByInstitution) {
      let mode: Awaited<ReturnType<AttendanceService['resolveAttendanceMode']>>;
      try {
        if (!(await this.isModuleEligible(institutionId, ModuleKey.ATTENDANCE)))
          continue;
        mode =
          await this.attendanceService.resolveAttendanceMode(institutionId);
      } catch {
        failedCampusIds.push(...institutionCampuses.map((campus) => campus.id));
        this.logger.error(
          `Auto-absent configuration failed for institution ${institutionId}`,
        );
        await this.logSafely({
          action: 'ATTENDANCE_AUTO_ABSENT_FAILED',
          entity: 'Attendance',
          institutionId,
          metadata: { stage: 'institution_configuration' },
        });
        continue;
      }

      for (const campus of institutionCampuses) {
        try {
          const now = new Date();
          const timezone = await this.timezoneResolver.resolveForCampus(
            campus.id,
          );
          const today = this.timezoneResolver.localDateString(timezone, now);
          const todayDayOfWeek = this.timezoneResolver.localDayOfWeek(
            timezone,
            now,
          );

          const cutoff = this.resolveCutoff(
            timezone,
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
              await this.logSafely({
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

          // P0-6 (§ 12 Verification 2): a due period landing on a closed
          // date must also short-circuit to zero — markPeriodAbsentees'
          // own roster is already correctly filtered (§ 6.2), but the
          // working-day/closure gate itself is the scheduler's
          // responsibility for this branch, same as the campus-wide branch
          // (which markCampusAbsentees checks internally).
          const isWorking = await this.workingDayResolver.isWorkingDay(
            institutionId,
            campus.id,
            today,
            todayDayOfWeek,
          );
          if (!isWorking) continue;

          const duePeriods = await this.prisma.periodSlot.findMany({
            where: {
              campusId: campus.id,
              dayOfWeek: todayDayOfWeek,
              deletedAt: null,
            },
            select: { id: true, endTime: true },
          });

          for (const period of duePeriods) {
            const periodCutoff = this.safeZonedTimeToInstant(
              timezone,
              today,
              period.endTime,
            );
            if (!periodCutoff || now < periodCutoff) continue;

            const periodResult =
              await this.attendanceService.markPeriodAbsentees(
                period.id,
                today,
              );
            periodProcessedCount += 1;
            if (periodResult.data.count > 0) {
              await this.logSafely({
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
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Auto-absent sweep failed for campus ${campus.id} (institution ${institutionId}): ${message}`,
          );
          await this.logSafely({
            action: 'ATTENDANCE_AUTO_ABSENT_FAILED',
            entity: 'Attendance',
            institutionId,
            metadata: { campusId: campus.id, error: message },
          });
          failedCampusIds.push(campus.id);
          continue;
        }
      }
    }

    this.logger.log(
      `Auto-absent job checked ${campuses.length} campus(es), processed ${processedCount} past cutoff and ${periodProcessedCount} due period slot(s); ${failedCampusIds.length} campus(es) failed.`,
    );
  }

  /**
   * Daily voucher-overdue sweep. Only flips status (PENDING -> OVERDUE); no
   * late-fee policy exists yet to auto-apply an amount (lateFeeFine is
   * currently a manual accountant-entered field), so that half of the
   * original P0-3 scope is intentionally deferred — see PROGRESS.md.
   *
   * P0-9 (§ 7.1): candidates are re-selected inside a Serializable
   * transaction, chunked (§ 7.1's batching note) so a large candidate set
   * doesn't hold one long-running transaction — the update and the audit
   * both act only on the set that's *still eligible at re-check time*, not
   * the outer selection, so a voucher paid between selection and the
   * transactional re-check is correctly excluded from both, per P0-9's
   * "audit only records actually transitioned" requirement. Failures are
   * isolated per chunk (§ 7.4) so one bad chunk doesn't abort the rest.
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async runVoucherOverdueJob() {
    const startOfToday = new Date(
      new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z',
    );

    const candidates = await this.prisma.feeVoucher.findMany({
      where: {
        status: { in: [VoucherStatus.PENDING, VoucherStatus.PARTIAL] },
        dueDate: { lt: startOfToday },
        deletedAt: null,
      },
      select: { id: true },
    });

    if (candidates.length === 0) {
      this.logger.log('Voucher-overdue job found no candidates.');
      return;
    }

    let totalTransitioned = 0;
    const candidateChunks = chunk(
      candidates.map((c) => c.id),
      RECHECK_CHUNK_SIZE,
    );

    for (const candidateIds of candidateChunks) {
      try {
        const transitioned = await this.prisma.$transaction(
          async (tx) => {
            const stillEligible = await tx.feeVoucher.findMany({
              where: {
                id: { in: candidateIds },
                status: { in: [VoucherStatus.PENDING, VoucherStatus.PARTIAL] },
                dueDate: { lt: startOfToday },
                deletedAt: null,
              },
              select: {
                id: true,
                student: {
                  select: { campus: { select: { institutionId: true } } },
                },
              },
            });
            if (!stillEligible.length) return [];

            await tx.feeVoucher.updateMany({
              where: { id: { in: stillEligible.map((v) => v.id) } },
              data: { status: VoucherStatus.OVERDUE },
            });

            return stillEligible;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        if (!transitioned.length) continue;
        totalTransitioned += transitioned.length;

        const idsByInstitution = new Map<string | null, string[]>();
        for (const voucher of transitioned) {
          const institutionId = voucher.student.campus?.institutionId ?? null;
          const ids = idsByInstitution.get(institutionId) ?? [];
          ids.push(voucher.id);
          idsByInstitution.set(institutionId, ids);
        }
        for (const [institutionId, ids] of idsByInstitution) {
          await this.auditLogService.log(null, {
            action: 'FEE_VOUCHER_AUTO_OVERDUE',
            entity: 'FeeVoucher',
            institutionId,
            metadata: { voucherIds: ids, count: ids.length },
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Voucher-overdue chunk failed: ${message}`);
        await this.logSafely({
          action: 'FEE_VOUCHER_AUTO_OVERDUE_FAILED',
          entity: 'FeeVoucher',
          institutionId: null,
          metadata: { candidateCount: candidateIds.length, error: message },
        });
        continue;
      }
    }

    this.logger.log(
      `Voucher-overdue job flipped ${totalTransitioned} voucher(s) to OVERDUE.`,
    );
  }

  /**
   * Daily subscription-lifecycle sweep: expired trials move to SUSPENDED so
   * the stored status matches reality for dashboards/listings. Runtime
   * access is already enforced independently by ModuleAccessService's own
   * endsAt check, so this job is a consistency/reporting fix, not the
   * primary enforcement mechanism.
   *
   * P0-9 (§ 7.1): same transactional re-check + chunking + per-chunk
   * failure isolation as runVoucherOverdueJob — a subscription renewed
   * between selection and the transactional re-check is correctly excluded
   * from both the update and the audit.
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
      select: { id: true },
    });

    if (expiredTrials.length === 0) {
      this.logger.log('Subscription-lifecycle job found no expired trials.');
      return;
    }

    let totalSuspended = 0;
    const candidateChunks = chunk(
      expiredTrials.map((s) => s.id),
      RECHECK_CHUNK_SIZE,
    );

    for (const candidateIds of candidateChunks) {
      try {
        const suspended = await this.prisma.$transaction(
          async (tx) => {
            const stillEligible = await tx.institutionSubscription.findMany({
              where: {
                id: { in: candidateIds },
                status: SubscriptionStatus.TRIAL,
                endsAt: { lt: now },
                deletedAt: null,
              },
              select: { id: true, institutionId: true, endsAt: true },
            });
            if (!stillEligible.length) return [];

            await tx.institutionSubscription.updateMany({
              where: { id: { in: stillEligible.map((s) => s.id) } },
              data: { status: SubscriptionStatus.SUSPENDED },
            });

            return stillEligible;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        if (!suspended.length) continue;
        totalSuspended += suspended.length;

        for (const subscription of suspended) {
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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Subscription-lifecycle chunk failed: ${message}`);
        await this.logSafely({
          action: 'SUBSCRIPTION_AUTO_SUSPENDED_FAILED',
          entity: 'InstitutionSubscription',
          institutionId: null,
          metadata: { candidateCount: candidateIds.length, error: message },
        });
        continue;
      }
    }

    this.logger.log(
      `Subscription-lifecycle job suspended ${totalSuspended} expired trial(s).`,
    );
  }

  /** Audit persistence (success or failure) must never starve subsequent institutions or chunks. */
  private async logSafely(
    entry: Parameters<AuditLogService['log']>[1],
  ): Promise<void> {
    try {
      await this.auditLogService.log(null, entry);
    } catch {
      this.logger.error(
        `Could not persist scheduler failure event ${entry.action}`,
      );
    }
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

  /** Null-tolerant cutoff resolution: an unparseable staff/student end-time
   *  string degrades to "no cutoff from that side" (matching the pre-P0-7
   *  behavior) rather than throwing and aborting the whole campus — actual
   *  DB/logic errors still propagate and get caught by the per-campus
   *  try/catch in runAutoAbsentJob. */
  private resolveCutoff(
    timezone: string,
    today: string,
    staffEndTime: string,
    studentEndTime: string,
  ): Date | null {
    const staffCutoff = this.safeZonedTimeToInstant(
      timezone,
      today,
      staffEndTime,
    );
    const studentCutoff = this.safeZonedTimeToInstant(
      timezone,
      today,
      studentEndTime,
    );
    if (!staffCutoff && !studentCutoff) return null;
    if (!staffCutoff) return studentCutoff;
    if (!studentCutoff) return staffCutoff;
    return staffCutoff > studentCutoff ? staffCutoff : studentCutoff;
  }

  private safeZonedTimeToInstant(
    timezone: string,
    dateStr: string,
    time: string,
  ): Date | null {
    try {
      return this.timezoneResolver.zonedTimeToInstant(timezone, dateStr, time);
    } catch {
      return null;
    }
  }
}
