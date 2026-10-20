-- AlterTable: additive and nullable, so no existing row is touched.
ALTER TABLE "institution_branding" ADD COLUMN "color_overrides" JSONB;
