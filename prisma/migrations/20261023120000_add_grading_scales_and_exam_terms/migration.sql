-- AlterTable
ALTER TABLE "institutions" ADD COLUMN     "current_grading_scale_id" UUID;

-- CreateTable
CREATE TABLE "grading_scales" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "active_scope_key" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "grading_scales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_bands" (
    "id" UUID NOT NULL,
    "grading_scale_id" UUID NOT NULL,
    "grade" TEXT NOT NULL,
    "min_percentage" DECIMAL(5,2) NOT NULL,
    "max_percentage" DECIMAL(5,2) NOT NULL,
    "remarks" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "active_scope_key" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "grade_bands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_terms" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "weight" DECIMAL(5,2) NOT NULL DEFAULT 1.00,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
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

    CONSTRAINT "exam_terms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "grading_scales_institution_id_idx" ON "grading_scales"("institution_id");

-- CreateIndex
CREATE UNIQUE INDEX "grading_scale_name_unique" ON "grading_scales"("institution_id", "name", "active_scope_key");

-- CreateIndex
CREATE INDEX "grade_bands_grading_scale_id_idx" ON "grade_bands"("grading_scale_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_band_grade_unique" ON "grade_bands"("grading_scale_id", "grade", "active_scope_key");

-- CreateIndex
CREATE INDEX "exam_terms_institution_id_idx" ON "exam_terms"("institution_id");

-- CreateIndex
CREATE INDEX "exam_terms_academic_year_id_idx" ON "exam_terms"("academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_term_unique" ON "exam_terms"("institution_id", "academic_year_id", "name", "active_scope_key");

-- AddForeignKey
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_current_grading_scale_id_fkey" FOREIGN KEY ("current_grading_scale_id") REFERENCES "grading_scales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grading_scales" ADD CONSTRAINT "grading_scales_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_bands" ADD CONSTRAINT "grade_bands_grading_scale_id_fkey" FOREIGN KEY ("grading_scale_id") REFERENCES "grading_scales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_terms" ADD CONSTRAINT "exam_terms_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_terms" ADD CONSTRAINT "exam_terms_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

