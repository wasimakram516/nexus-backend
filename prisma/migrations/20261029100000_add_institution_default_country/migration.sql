-- The country a school's phone numbers usually belong to, so people type the local number without choosing a code every time. Existing schools start on Pakistan.
ALTER TABLE "institutions" ADD COLUMN "default_country" TEXT NOT NULL DEFAULT 'PK';
