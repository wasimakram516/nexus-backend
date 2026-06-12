-- AlterTable
ALTER TABLE "users" ADD COLUMN     "permission_overrides" JSONB,
ADD COLUMN     "permission_template_id" UUID;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_permission_template_id_fkey" FOREIGN KEY ("permission_template_id") REFERENCES "permission_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
