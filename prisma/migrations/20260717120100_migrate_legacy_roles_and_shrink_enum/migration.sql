-- Remap every legacy TEACHER/ACCOUNTANT row onto STAFF (added and committed
-- in the prior migration) across every table that stores a UserRole.
UPDATE "users" SET "role" = 'STAFF' WHERE "role" IN ('TEACHER', 'ACCOUNTANT');
UPDATE "attendance" SET "role" = 'STAFF' WHERE "role" IN ('TEACHER', 'ACCOUNTANT');
UPDATE "staff_salaries" SET "role" = 'STAFF' WHERE "role" IN ('TEACHER', 'ACCOUNTANT');
UPDATE "salary_deduction_rules" SET "role" = 'STAFF' WHERE "role" IN ('TEACHER', 'ACCOUNTANT');

-- Postgres has no direct "remove enum value" operation: recreate the type
-- without TEACHER/ACCOUNTANT, repoint every column that used it, then swap.
CREATE TYPE "UserRole_new" AS ENUM ('SUPERADMIN', 'ADMIN', 'STAFF', 'STUDENT', 'GUARDIAN');

ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TABLE "attendance" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TABLE "staff_salaries" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TABLE "salary_deduction_rules" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");

DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
