-- Lets an institution choose which custom field values appear on printed documents.
ALTER TABLE "custom_field_definitions" ADD COLUMN "show_on_print" BOOLEAN NOT NULL DEFAULT false;
