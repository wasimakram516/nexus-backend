-- Fix for a real bug found during implementation review of
-- P0-6-7-9-CORRECTIVE-DESIGN.md § 5.1: the original
-- institution_closure_date_unique constraint put the nullable campus_id
-- column directly in a unique index. Postgres treats NULL as distinct from
-- every other NULL in a unique index, so two institution-wide closures
-- (campus_id = NULL) for the same date would NOT have collided — the exact
-- NULL-uniqueness trap this codebase's own Attendance.periodKey and
-- Exam.retakeKey columns exist to avoid, reintroduced through a different
-- door. Fixed with the identical sentinel-column pattern: a non-nullable
-- campus_scope_key ("INSTITUTION" or the literal campus id), which is what
-- now actually goes in the unique index.
--
-- No existing rows are affected beyond the default backfill: the
-- institution_closure_dates table was created moments before this fix in
-- the same corrective pass, with zero real closure dates entered by any
-- user yet.

-- DropIndex
DROP INDEX "institution_closure_date_unique";

-- AlterTable
ALTER TABLE "institution_closure_dates" ADD COLUMN     "campus_scope_key" TEXT NOT NULL DEFAULT 'INSTITUTION';

-- CreateIndex
CREATE UNIQUE INDEX "institution_closure_date_unique" ON "institution_closure_dates"("institution_id", "campus_scope_key", "date", "active_scope_key");
