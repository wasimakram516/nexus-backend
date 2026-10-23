-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ExamType" AS ENUM ('REGULAR', 'RETAKE', 'IMPROVEMENT', 'SUPPLEMENTARY');

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "exam_term_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "grading_scale_id" UUID NOT NULL,
    "status" "ExamStatus" NOT NULL DEFAULT 'DRAFT',
    "exam_type" "ExamType" NOT NULL DEFAULT 'REGULAR',
    "original_exam_id" UUID,
    "retake_key" TEXT NOT NULL DEFAULT 'REGULAR',
    "unlocked_for_editing" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(3),
    "published_by" UUID,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "active_scope_key" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exams_academic_year_id_idx" ON "exams"("academic_year_id");

-- CreateIndex
CREATE INDEX "exams_campus_id_idx" ON "exams"("campus_id");

-- CreateIndex
CREATE INDEX "exams_class_id_idx" ON "exams"("class_id");

-- CreateIndex
CREATE INDEX "exams_exam_term_id_idx" ON "exams"("exam_term_id");

-- CreateIndex
CREATE INDEX "exams_grading_scale_id_idx" ON "exams"("grading_scale_id");

-- CreateIndex
CREATE INDEX "exams_original_exam_id_idx" ON "exams"("original_exam_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_class_term_retake_unique" ON "exams"("class_id", "exam_term_id", "retake_key", "active_scope_key");

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_exam_term_id_fkey" FOREIGN KEY ("exam_term_id") REFERENCES "exam_terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_grading_scale_id_fkey" FOREIGN KEY ("grading_scale_id") REFERENCES "grading_scales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_original_exam_id_fkey" FOREIGN KEY ("original_exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

