-- Salary adjustments (bonuses/deductions) previously carried no payroll
-- period, so paySalary() summed every adjustment ever recorded for a user
-- into every payment regardless of month/year. Add explicit month/year
-- columns, backfilling existing rows from their adjustment_date so no
-- historical row is left without a period, then enforce NOT NULL.
ALTER TABLE "salary_adjustments" ADD COLUMN "month" INTEGER;
ALTER TABLE "salary_adjustments" ADD COLUMN "year" INTEGER;

UPDATE "salary_adjustments"
SET "month" = EXTRACT(MONTH FROM "adjustment_date")::INTEGER,
    "year" = EXTRACT(YEAR FROM "adjustment_date")::INTEGER
WHERE "month" IS NULL OR "year" IS NULL;

ALTER TABLE "salary_adjustments" ALTER COLUMN "month" SET NOT NULL;
ALTER TABLE "salary_adjustments" ALTER COLUMN "year" SET NOT NULL;

CREATE INDEX "salary_adjustments_user_id_campus_id_month_year_idx"
  ON "salary_adjustments"("user_id", "campus_id", "month", "year");
