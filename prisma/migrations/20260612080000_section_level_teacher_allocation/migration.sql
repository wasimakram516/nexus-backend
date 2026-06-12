-- DropIndex
DROP INDEX "teacher_subject_unique";

-- AlterTable
ALTER TABLE "teacher_subjects" ADD COLUMN     "section_id" UUID;

-- CreateIndex
CREATE INDEX "teacher_subjects_section_id_idx" ON "teacher_subjects"("section_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_subject_unique" ON "teacher_subjects"("teacher_id", "class_id", "subject_id", "section_id", "campus_id", "active_scope_key");

-- AddForeignKey
ALTER TABLE "teacher_subjects" ADD CONSTRAINT "teacher_subjects_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
