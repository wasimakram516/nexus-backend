-- Before/after snapshots for the audit trail diff viewer (decision #37).
-- Nullable JSON: most historical rows and bulk-operation entries will never
-- have one (snapshots are only captured for single-record mutations), and
-- CREATED/hard-DELETED entries only ever populate one side.
ALTER TABLE "audit_logs" ADD COLUMN "before" JSONB;
ALTER TABLE "audit_logs" ADD COLUMN "after" JSONB;
