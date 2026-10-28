-- The country each saved phone number was entered for, kept beside the number so a shared calling code (+1, +7, +44) never loses which country it was. Nullable: numbers saved before this are read from their calling code until edited.
ALTER TABLE "contacts" ADD COLUMN "phone1_country" TEXT;
ALTER TABLE "contacts" ADD COLUMN "phone2_country" TEXT;
ALTER TABLE "contacts" ADD COLUMN "whatsapp_country" TEXT;
ALTER TABLE "institutions" ADD COLUMN "contact_phone_country" TEXT;
