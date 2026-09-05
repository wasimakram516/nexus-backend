-- AlterTable
ALTER TABLE "campuses" ADD COLUMN     "code" TEXT;

-- AlterTable
ALTER TABLE "institutions" ADD COLUMN     "current_academic_year_id" UUID;

-- CreateTable
CREATE TABLE "academic_years" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" TIMESTAMPTZ(3) NOT NULL,
    "end_date" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "active_scope_key" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_year_campus_overrides" (
    "id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "start_date" TIMESTAMPTZ(3),
    "end_date" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "active_scope_key" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "academic_year_campus_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "academic_years_institution_id_idx" ON "academic_years"("institution_id");

-- CreateIndex
CREATE UNIQUE INDEX "academic_year_name_unique" ON "academic_years"("institution_id", "name", "active_scope_key");

-- CreateIndex
CREATE INDEX "academic_year_campus_overrides_campus_id_idx" ON "academic_year_campus_overrides"("campus_id");

-- CreateIndex
CREATE UNIQUE INDEX "academic_year_campus_override_unique" ON "academic_year_campus_overrides"("academic_year_id", "campus_id", "active_scope_key");

-- AddForeignKey
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_current_academic_year_id_fkey" FOREIGN KEY ("current_academic_year_id") REFERENCES "academic_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_year_campus_overrides" ADD CONSTRAINT "academic_year_campus_overrides_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_year_campus_overrides" ADD CONSTRAINT "academic_year_campus_overrides_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
