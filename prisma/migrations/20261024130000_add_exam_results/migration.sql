-- CreateTable
CREATE TABLE "exam_results" (
    "id" UUID NOT NULL,
    "exam_subject_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "section_id" UUID,
    "marks_obtained" DECIMAL(6,2),
    "is_absent" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "active_scope_key" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exam_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exam_results_exam_subject_id_idx" ON "exam_results"("exam_subject_id");

-- CreateIndex
CREATE INDEX "exam_results_student_id_idx" ON "exam_results"("student_id");

-- CreateIndex
CREATE INDEX "exam_results_section_id_idx" ON "exam_results"("section_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_result_unique" ON "exam_results"("exam_subject_id", "student_id", "active_scope_key");

-- AddForeignKey
ALTER TABLE "exam_results" ADD CONSTRAINT "exam_results_exam_subject_id_fkey" FOREIGN KEY ("exam_subject_id") REFERENCES "exam_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_results" ADD CONSTRAINT "exam_results_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_results" ADD CONSTRAINT "exam_results_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

