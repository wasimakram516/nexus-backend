-- Institution branding previously had one color set applied regardless of
-- theme mode. Split into explicit light/dark pairs so an institution's
-- brand actually looks intentional in both modes, not just whichever one
-- happened to be the (previously hardcoded-dark) default.
ALTER TABLE "institution_branding" ADD COLUMN "primary_color_light" TEXT;
ALTER TABLE "institution_branding" ADD COLUMN "secondary_color_light" TEXT;
ALTER TABLE "institution_branding" ADD COLUMN "accent_color_light" TEXT;
ALTER TABLE "institution_branding" ADD COLUMN "primary_color_dark" TEXT;
ALTER TABLE "institution_branding" ADD COLUMN "secondary_color_dark" TEXT;
ALTER TABLE "institution_branding" ADD COLUMN "accent_color_dark" TEXT;

-- Backfill: existing rows only ever configured one set, applied to both
-- modes historically — carry that forward into both new slots so nothing
-- an admin already picked silently reverts to the new defaults.
UPDATE "institution_branding"
SET "primary_color_light" = "primary_color",
    "secondary_color_light" = "secondary_color",
    "accent_color_light" = "accent_color",
    "primary_color_dark" = "primary_color",
    "secondary_color_dark" = "secondary_color",
    "accent_color_dark" = "accent_color";

ALTER TABLE "institution_branding" DROP COLUMN "primary_color";
ALTER TABLE "institution_branding" DROP COLUMN "secondary_color";
ALTER TABLE "institution_branding" DROP COLUMN "accent_color";
