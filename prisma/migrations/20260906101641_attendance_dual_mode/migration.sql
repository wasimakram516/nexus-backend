-- DropIndex
DROP INDEX "attendance_unique";

-- AlterTable
ALTER TABLE "attendance" ADD COLUMN     "period_id" UUID,
ADD COLUMN     "period_key" TEXT NOT NULL DEFAULT 'DAILY';

-- CreateIndex
CREATE INDEX "attendance_period_id_idx" ON "attendance"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_unique" ON "attendance"("user_id", "campus_id", "date", "period_key", "active_scope_key");

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "period_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
