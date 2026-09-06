-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- AlterEnum
ALTER TYPE "ModuleKey" ADD VALUE 'TIMETABLE';

-- CreateTable
CREATE TABLE "period_slots" (
    "id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "subject_id" UUID,
    "staff_profile_id" UUID,
    "name" TEXT NOT NULL,
    "period_number" INTEGER NOT NULL,
    "day_of_week" "DayOfWeek" NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "active_scope_key" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "period_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "period_slots_campus_id_idx" ON "period_slots"("campus_id");

-- CreateIndex
CREATE INDEX "period_slots_class_id_idx" ON "period_slots"("class_id");

-- CreateIndex
CREATE INDEX "period_slots_subject_id_idx" ON "period_slots"("subject_id");

-- CreateIndex
CREATE INDEX "period_slots_staff_profile_id_idx" ON "period_slots"("staff_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "period_slot_section_day_number_unique" ON "period_slots"("section_id", "day_of_week", "period_number", "active_scope_key");

-- AddForeignKey
ALTER TABLE "period_slots" ADD CONSTRAINT "period_slots_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_slots" ADD CONSTRAINT "period_slots_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_slots" ADD CONSTRAINT "period_slots_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_slots" ADD CONSTRAINT "period_slots_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_slots" ADD CONSTRAINT "period_slots_staff_profile_id_fkey" FOREIGN KEY ("staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
