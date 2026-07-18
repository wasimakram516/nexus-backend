-- Rename permission_templates -> roles: institution-defined roles now hold a
-- feature x action permission matrix instead of a per-module view/manage map.
-- The table is renamed in place (not recreated) so existing role assignments
-- and permission JSON survive; the JSON shape itself is migrated by the
-- application-level PERMISSION_CATALOG resolver, not by this migration.
ALTER TABLE "permission_templates" RENAME TO "roles";
ALTER TABLE "roles" RENAME CONSTRAINT "permission_templates_pkey" TO "roles_pkey";
ALTER TABLE "roles" RENAME CONSTRAINT "permission_templates_institution_id_fkey" TO "roles_institution_id_fkey";
ALTER INDEX "permission_template_unique" RENAME TO "role_unique";

-- Rename users.permission_template_id -> role_id to match.
ALTER TABLE "users" RENAME COLUMN "permission_template_id" TO "role_id";
ALTER TABLE "users" RENAME CONSTRAINT "users_permission_template_id_fkey" TO "users_role_id_fkey";

-- Login identifier for non-staff archetypes (registration number for STUDENT,
-- phone for GUARDIAN); null for STAFF/ADMIN/SUPERADMIN who use email. Nullable
-- + unique-per-scope mirrors the existing email uniqueness pattern, and multiple
-- NULLs are allowed by Postgres so staff rows never collide on this column.
ALTER TABLE "users" ADD COLUMN "identifier" TEXT;
CREATE UNIQUE INDEX "user_identifier_active_scope_unique" ON "users"("identifier", "active_scope_key");

-- Add STAFF ahead of remapping legacy TEACHER/ACCOUNTANT rows onto it. Split
-- into its own migration file/transaction: Postgres forbids using a
-- newly-added enum value inside the same transaction that added it.
ALTER TYPE "UserRole" ADD VALUE 'STAFF';
