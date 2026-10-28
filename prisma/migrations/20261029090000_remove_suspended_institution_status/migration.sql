-- A school is either Active or Inactive. "Suspended" meant the same as Inactive
-- (billing holds live on the subscription status), so any school still marked
-- Suspended becomes Inactive and the value is removed.

UPDATE "institutions" SET "status" = 'INACTIVE' WHERE "status" = 'SUSPENDED';

ALTER TYPE "InstitutionStatus" RENAME TO "InstitutionStatus_old";
CREATE TYPE "InstitutionStatus" AS ENUM ('ACTIVE', 'INACTIVE');

ALTER TABLE "institutions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "institutions"
  ALTER COLUMN "status" TYPE "InstitutionStatus"
  USING ("status"::text::"InstitutionStatus");
ALTER TABLE "institutions" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

DROP TYPE "InstitutionStatus_old";
