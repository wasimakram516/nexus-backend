-- Background is now a customizable branding color too, alongside
-- primary/secondary/accent — Nexus's own default light-mode background
-- moved off wisemensoft's warm "bone" tone, and institutions get the same
-- choice rather than being stuck with whatever the app default is.
ALTER TABLE "institution_branding" ADD COLUMN "background_color_light" TEXT;
ALTER TABLE "institution_branding" ADD COLUMN "background_color_dark" TEXT;
