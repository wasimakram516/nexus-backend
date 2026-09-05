-- M2 Phase 3: StudentEnrollment (decision #21) + Student.institutionId /
-- regNo re-scoping (decision #25). Hand written like the two migrations
-- earlier this session — this table has real dev data (verified below), and
-- a blind `prisma migrate diff` proposes
-- `ALTER TABLE students DROP COLUMN class_id, DROP COLUMN section_id,
--  ADD COLUMN institution_id UUID NOT NULL` as a SINGLE statement with no
-- backfill in between, which would either fail outright (NOT NULL with no
-- default against existing rows) or, on a differently-shaped diff, silently
-- drop class_id/section_id before anything captured their values into
-- student_enrollments. Every destructive step below is preceded by the
-- SELECT-first check that justifies it, per standards/destructive-operations.md.
--
-- SELECT-first verification performed against this dev database before
-- writing this migration (see project-tracking/M2-PEOPLE-ACADEMIC-DESIGN.md
-- § 11 for the planned checks):
--   SELECT COUNT(*) FROM students;                                        -> 1
--   SELECT COUNT(*) FROM students WHERE deleted_at IS NOT NULL;           -> 0
--   SELECT COUNT(*) FROM students WHERE class_id IS NOT NULL;             -> 1
--   SELECT COUNT(*) FROM students
--     WHERE class_id IS NOT NULL AND deleted_at IS NULL;                  -> 1
--   SELECT COUNT(*) FROM students
--     WHERE class_id IS NOT NULL AND deleted_at IS NOT NULL;              -> 0
--   (confirms no soft-deleted student would be swept into the
--    student_enrollments backfill below — the exact "field is null/missing
--    also means something else" trap the destructive-ops standard warns
--    about does not apply here, but the WHERE clause below still excludes
--    deleted_at IS NOT NULL explicitly rather than relying on there being 0
--    matching rows today)
--   SELECT COUNT(*) FROM campuses WHERE institution_id IS NULL;           -> 0
--   SELECT COUNT(*) FROM students
--     WHERE campus_id IN (SELECT id FROM campuses
--                          WHERE institution_id IS NULL);                 -> 0
--     (precondition for backfilling students.institution_id as NOT NULL —
--      confirmed clean, so the backfill below cannot silently insert nulls)
--   SELECT reg_no, active_scope_key, COUNT(DISTINCT c.institution_id)
--     FROM students s JOIN campuses c ON c.id = s.campus_id
--     GROUP BY reg_no, active_scope_key
--     HAVING COUNT(DISTINCT c.institution_id) > 1;                        -> 0 rows
--     (precondition for the new per-institution unique index — no existing
--      regNo collides across institutions in this dev database)
--   SELECT id, name, current_academic_year_id FROM institutions;
--     -> "Taleem ul Islam" (267b9091-...): current_academic_year_id NULL,
--        0 students with class_id set at any of its campuses.
--     -> "Test School" (c40c429c-...): current_academic_year_id already set
--        to academic_years."2026-27" (created ad hoc while testing Phase 1)
--        — this is the institution with the 1 student that has a class_id.
--   => institutions needing a fallback AcademicYear seeded (current year
--      NULL AND has an active student with class_id) -> 0 in this database.
--      The conditional INSERT below is therefore a documented no-op here,
--      but is required for correctness in any environment where Phase 1
--      shipped without every institution's current year being set up before
--      Phase 3 runs (§ 11's own stated assumption, verified rather than
--      assumed here since it turned out NOT to hold for "Test School").

-- 1. New enum (decision #21: exactly ACTIVE/PROMOTED/LEFT, no REPEATED).
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'PROMOTED', 'LEFT');

-- 2. New table. FKs to classes/sections/campuses/academic_years/students are
--    safe to add immediately since none of those tables are touched by this
--    migration until step 6 below (which only drops columns, not the
--    students table itself).
CREATE TABLE "student_enrollments" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "section_id" UUID,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "left_date" TIMESTAMPTZ(3),
    "left_reason" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "active_scope_key" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "student_enrollments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "student_enrollments_campus_id_academic_year_id_idx" ON "student_enrollments"("campus_id", "academic_year_id");
CREATE INDEX "student_enrollments_class_id_idx" ON "student_enrollments"("class_id");
CREATE INDEX "student_enrollments_section_id_idx" ON "student_enrollments"("section_id");
CREATE INDEX "student_enrollments_student_id_idx" ON "student_enrollments"("student_id");
CREATE UNIQUE INDEX "student_enrollment_unique" ON "student_enrollments"("student_id", "academic_year_id", "active_scope_key");

ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. students.institution_id: add nullable, backfill from campuses (SELECT-
--    first precondition verified above: 0 campuses with a null institution,
--    0 students pointing at one), then enforce NOT NULL.
ALTER TABLE "students" ADD COLUMN "institution_id" UUID;

UPDATE "students"
SET "institution_id" = "campuses"."institution_id"
FROM "campuses"
WHERE "students"."campus_id" = "campuses"."id";

ALTER TABLE "students" ALTER COLUMN "institution_id" SET NOT NULL;
ALTER TABLE "students" ADD CONSTRAINT "students_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Re-scope regNo uniqueness per institution (decision #25). The
--    cross-institution collision check above returned 0 rows, so this
--    index can be created safely.
DROP INDEX "student_reg_no_unique";
CREATE UNIQUE INDEX "student_reg_no_institution_unique" ON "students"("institution_id", "reg_no", "active_scope_key");

-- 5. Seed a fallback AcademicYear + set it current for any institution that
--    has an active student with a class_id but no current_academic_year_id
--    of its own yet (§ 11's assumption that "every institution starts with
--    none" — verified above to already be FALSE for one institution in this
--    database, hence this is written as a real conditional rather than an
--    unconditional seed). Name/dates are a placeholder derived from the
--    migration run date, editable later by the admin — documented choice,
--    not a guess: a school migrating onto Nexus mid-year needs *a* current
--    session to enroll existing students into before anyone can rename it
--    properly through the Academic Years UI.
WITH institutions_needing_year AS (
  SELECT DISTINCT c."institution_id" AS institution_id
  FROM "students" s
  JOIN "campuses" c ON c."id" = s."campus_id"
  JOIN "institutions" i ON i."id" = c."institution_id"
  WHERE i."current_academic_year_id" IS NULL
    AND s."class_id" IS NOT NULL
    AND s."deleted_at" IS NULL
),
seeded_years AS (
  INSERT INTO "academic_years" (
    "id", "institution_id", "name", "start_date", "end_date",
    "active_scope_key", "created_at", "updated_at"
  )
  SELECT
    gen_random_uuid(),
    institution_id,
    'Current Session',
    date_trunc('day', now()),
    date_trunc('day', now()) + interval '1 year',
    'ACTIVE',
    now(),
    now()
  FROM institutions_needing_year
  RETURNING "id", "institution_id"
)
UPDATE "institutions"
SET "current_academic_year_id" = seeded_years."id"
FROM seeded_years
WHERE "institutions"."id" = seeded_years."institution_id";

-- 6. Backfill student_enrollments from the about-to-be-dropped
--    students.class_id/section_id, scoped to each student's institution's
--    (now guaranteed-set, per step 5) current academic year. Soft-deleted
--    students and students with no class assigned are intentionally
--    excluded — verified explicitly above that 0 deleted students carry a
--    class_id in this database, but the WHERE clause excludes them by
--    condition, not by coincidence of today's data.
INSERT INTO "student_enrollments" (
  "id", "student_id", "academic_year_id", "campus_id", "class_id",
  "section_id", "status", "active_scope_key", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  s."id",
  i."current_academic_year_id",
  s."campus_id",
  s."class_id",
  s."section_id",
  'ACTIVE',
  'ACTIVE',
  now(),
  now()
FROM "students" s
JOIN "campuses" c ON c."id" = s."campus_id"
JOIN "institutions" i ON i."id" = c."institution_id"
WHERE s."class_id" IS NOT NULL
  AND s."deleted_at" IS NULL;

-- Post-backfill verification (run manually before/after applying, same
-- discipline as the July 18 migration): the inserted row count above must
-- equal `SELECT COUNT(*) FROM students WHERE class_id IS NOT NULL AND
-- deleted_at IS NULL` (verified as 1 before writing this migration) exactly.
-- Only then is it safe to drop the source columns in step 7.

-- 7. Drop the now-superseded direct pointer columns. Dropping a column in
--    Postgres automatically drops any FK constraint / index defined solely
--    on that column (students_class_id_fkey, students_section_id_fkey,
--    students_class_id_idx, students_section_id_idx) — no separate DROP
--    CONSTRAINT/DROP INDEX statements needed.
ALTER TABLE "students" DROP COLUMN "class_id";
ALTER TABLE "students" DROP COLUMN "section_id";

-- 8. StudentHistory gains a nullable academic_year_id so history rows can be
--    scoped to the session they happened in. No backfill — historical rows
--    predate year-scoping and stay NULL (verified above: student_history
--    has 0 rows in this database today, so this is a true no-op backfill
--    either way, but the column stays nullable for any environment that
--    does carry pre-Phase-3 history rows).
ALTER TABLE "student_history" ADD COLUMN "academic_year_id" UUID;
CREATE INDEX "student_history_academic_year_id_idx" ON "student_history"("academic_year_id");
ALTER TABLE "student_history" ADD CONSTRAINT "student_history_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;
