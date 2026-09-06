-- AlterEnum
ALTER TYPE "ModuleKey" ADD VALUE 'NOTICES';

-- CreateTable
CREATE TABLE "notices" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "campus_id" UUID,
    "class_id" UUID,
    "section_id" UUID,
    "target_role" "UserRole",
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" JSONB,
    "publish_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "active_scope_key" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notices_institution_id_publish_at_idx" ON "notices"("institution_id", "publish_at");

-- CreateIndex
CREATE INDEX "notices_campus_id_idx" ON "notices"("campus_id");

-- CreateIndex
CREATE INDEX "notices_class_id_idx" ON "notices"("class_id");

-- CreateIndex
CREATE INDEX "notices_section_id_idx" ON "notices"("section_id");

-- AddForeignKey
ALTER TABLE "notices" ADD CONSTRAINT "notices_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notices" ADD CONSTRAINT "notices_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notices" ADD CONSTRAINT "notices_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notices" ADD CONSTRAINT "notices_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
