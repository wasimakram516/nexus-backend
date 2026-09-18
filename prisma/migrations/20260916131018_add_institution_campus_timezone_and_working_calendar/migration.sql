-- P0-7 (see P0-6-7-9-CORRECTIVE-DESIGN.md § 3.3): campus_timezone is purely
-- additive (nullable, no default) — zero behavior change until a campus
-- explicitly sets it; TimezoneResolverService falls through to the parent
-- Institution.timezone.
-- AlterTable
ALTER TABLE "campuses" ADD COLUMN     "campus_timezone" TEXT;

-- P0-7 (see P0-6-7-9-CORRECTIVE-DESIGN.md § 3.3, Wasim-confirmed § 11 #2):
-- this IS a behavior-changing migration, not purely additive. Every
-- existing institution's cutoff/lateness/absence-date logic has, until now,
-- silently treated admin-entered clock times as literal UTC. This single
-- statement backfills every pre-existing institution row's timezone to
-- 'Asia/Karachi' (Postgres populates NOT NULL DEFAULT columns for existing
-- rows in the same statement — no separate UPDATE step is needed, but the
-- effect is identical to the doc's documented backfill-then-constrain
-- policy) because the confirmed institution roster is entirely
-- Pakistan-based. Any institution actually operating in a different zone
-- must be corrected via the settings UI post-deploy — a real, visible,
-- one-time shift in when cutoffs/absences are evaluated (UTC+5 instead of
-- UTC+0), not a silent one.
-- AlterTable
ALTER TABLE "institutions" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Karachi';

-- CreateTable
CREATE TABLE "institution_working_calendars" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "working_days" "DayOfWeek"[],
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "active_scope_key" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "institution_working_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "institution_closure_dates" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "campus_id" UUID,
    "date" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "active_scope_key" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "institution_closure_dates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "institution_working_calendars_institution_id_key" ON "institution_working_calendars"("institution_id");

-- CreateIndex
CREATE INDEX "institution_closure_dates_institution_id_date_idx" ON "institution_closure_dates"("institution_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "institution_closure_date_unique" ON "institution_closure_dates"("institution_id", "campus_id", "date", "active_scope_key");

-- AddForeignKey
ALTER TABLE "institution_working_calendars" ADD CONSTRAINT "institution_working_calendars_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institution_closure_dates" ADD CONSTRAINT "institution_closure_dates_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institution_closure_dates" ADD CONSTRAINT "institution_closure_dates_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
