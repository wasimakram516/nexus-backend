-- M2 Phase 2: generalize Teacher -> StaffProfile (decision #12/#18). Hand
-- written like the 2026-07-18 enum-shrink migration, NOT a blind
-- `prisma migrate dev` accept-all: this table has real dev data (verified
-- below), and Prisma's own diff engine proposed a destructive drop/recreate
-- for the renamed table + teacher_subjects.teacher_id column, which would
-- have permanently lost the seeded rows. Every step here is a RENAME, never
-- a DROP + CREATE, so existing rows/ids survive untouched.
--
-- SELECT-first verification performed before writing this migration (see
-- CLAUDE.md destructive-ops standard — applies to any bulk-affecting
-- UPDATE/ALTER, not just DELETE):
--   SELECT COUNT(*) FROM teachers;                              -> 1
--   SELECT COUNT(*) FROM teachers WHERE deleted_at IS NULL;     -> 1
--   SELECT COUNT(*) FROM teacher_subjects;                      -> 1
--   SELECT COUNT(*) FROM contacts WHERE teacher_id IS NOT NULL; -> 0
--   SELECT COUNT(*) FROM contacts WHERE person_type = 'TEACHER';-> 0
--   SELECT COUNT(*) FROM roles WHERE permissions ? 'teachers';  -> 0
--   SELECT COUNT(*) FROM users
--     WHERE permission_overrides IS NOT NULL
--       AND permission_overrides ? 'teachers';                  -> 0
-- The backfill below (employment_type/designation/joining_date) is
-- therefore known to touch exactly 1 row, and the JSON remap is a no-op on
-- this dev database today but is still required for correctness against any
-- other environment/export that does carry a "teachers" permission key.

-- 1. Rename the table in place (preserves rows/ids) and rename its
--    constraints/indexes to match, same convention as the
--    permission_templates -> roles rename in 20260717120000.
ALTER TABLE "teachers" RENAME TO "staff_profiles";
ALTER TABLE "staff_profiles" RENAME CONSTRAINT "teachers_pkey" TO "staff_profiles_pkey";
ALTER TABLE "staff_profiles" RENAME CONSTRAINT "teachers_user_id_fkey" TO "staff_profiles_user_id_fkey";
ALTER TABLE "staff_profiles" RENAME CONSTRAINT "teachers_campus_id_fkey" TO "staff_profiles_campus_id_fkey";
ALTER INDEX "teachers_user_id_key" RENAME TO "staff_profiles_user_id_key";
ALTER INDEX "teachers_campus_id_idx" RENAME TO "staff_profiles_campus_id_idx";

-- 2. New enum for employment type (decision #12).
CREATE TYPE "EmploymentType" AS ENUM ('TEACHING', 'NON_TEACHING');

-- 3. New columns, nullable for now so the backfill below can populate them
--    before NOT NULL is enforced.
ALTER TABLE "staff_profiles"
  ADD COLUMN "employment_type" "EmploymentType",
  ADD COLUMN "designation" TEXT,
  ADD COLUMN "joining_date" TIMESTAMPTZ(3);

-- 4. Backfill: every existing row predates this generalization, so it is,
--    by definition, a teacher (verified: 1 row, matching the pre-migration
--    SELECT COUNT(*) FROM teachers above). joining_date has no better
--    historical proxy than created_at.
UPDATE "staff_profiles"
SET "employment_type" = 'TEACHING',
    "designation" = 'Teacher',
    "joining_date" = "created_at";

-- 5. Now safe to enforce NOT NULL (both fields are required, no default,
--    per § 4.5's deliberate cleanliness call for new rows going forward).
ALTER TABLE "staff_profiles"
  ALTER COLUMN "employment_type" SET NOT NULL,
  ALTER COLUMN "designation" SET NOT NULL,
  ALTER COLUMN "joining_date" SET NOT NULL;

-- 6. New index on employment_type (Prisma's default naming convention).
CREATE INDEX "staff_profiles_employment_type_idx" ON "staff_profiles"("employment_type");

-- 7. Rename the FK column on teacher_subjects. TeacherSubject itself is NOT
--    renamed (still a teaching-specific concept, per § 4.5) — only the FK.
--    Postgres tracks index/constraint columns by attribute number, so the
--    existing "teacher_subject_unique" unique index automatically reflects
--    the renamed column with no DROP/CREATE needed (kept as-is, per the
--    design doc's "reviewer's call" on whether to rename it).
ALTER TABLE "teacher_subjects" RENAME COLUMN "teacher_id" TO "staff_profile_id";
ALTER TABLE "teacher_subjects" RENAME CONSTRAINT "teacher_subjects_teacher_id_fkey" TO "teacher_subjects_staff_profile_id_fkey";

-- 8. Rename the FK column on contacts (owner-polymorphic FK set).
ALTER TABLE "contacts" RENAME COLUMN "teacher_id" TO "staff_profile_id";
ALTER TABLE "contacts" RENAME CONSTRAINT "contacts_teacher_id_fkey" TO "contacts_staff_profile_id_fkey";
ALTER INDEX "contacts_teacher_id_idx" RENAME TO "contacts_staff_profile_id_idx";

-- 9. Rename the ContactPersonType enum value in place — Postgres supports
--    this directly, no enum-shrink recreate-and-swap dance required (unlike
--    the 2026-07-18 UserRole shrink, which removed values rather than
--    renaming one 1:1).
ALTER TYPE "ContactPersonType" RENAME VALUE 'TEACHER' TO 'STAFF';

-- 10. Data migration for the PERMISSION_CATALOG key rename (teachers ->
--     staff_profiles), same category as the P0-1 view -> read remap: any
--     Role.permissions or User.permissionOverrides JSON blob carrying a
--     "teachers" key must follow the code rename or every institution that
--     granted that permission silently loses it. Guarded with the `?`
--     containment operator so untouched rows are true no-ops.
UPDATE "roles"
SET "permissions" = ("permissions" - 'teachers') || jsonb_build_object('staff_profiles', "permissions"->'teachers')
WHERE "permissions" ? 'teachers';

UPDATE "users"
SET "permission_overrides" = ("permission_overrides" - 'teachers') || jsonb_build_object('staff_profiles', "permission_overrides"->'teachers')
WHERE "permission_overrides" IS NOT NULL
  AND "permission_overrides" ? 'teachers';
