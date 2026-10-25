-- A room on each period, and dated substitutions of the teacher for one period.
ALTER TABLE "period_slots" ADD COLUMN "room" TEXT;

CREATE TABLE "period_substitutions" (
    "id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "period_slot_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "substitute_staff_profile_id" UUID NOT NULL,
    "reason" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "active_scope_key" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "period_substitutions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "period_substitutions_campus_id_date_idx" ON "period_substitutions"("campus_id", "date");
CREATE INDEX "period_substitutions_substitute_staff_profile_id_date_idx" ON "period_substitutions"("substitute_staff_profile_id", "date");
CREATE UNIQUE INDEX "period_substitution_unique" ON "period_substitutions"("period_slot_id", "date", "active_scope_key");

ALTER TABLE "period_substitutions" ADD CONSTRAINT "period_substitutions_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "period_substitutions" ADD CONSTRAINT "period_substitutions_period_slot_id_fkey" FOREIGN KEY ("period_slot_id") REFERENCES "period_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "period_substitutions" ADD CONSTRAINT "period_substitutions_substitute_staff_profile_id_fkey" FOREIGN KEY ("substitute_staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
