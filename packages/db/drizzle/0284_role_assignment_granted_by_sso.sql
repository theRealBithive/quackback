-- Whether a workspace role assignment was written by a sign-in through an
-- identity provider (a role rule's role, or the provider's default role),
-- rather than by a person. Under a provider's "Every sign-in" role sync, a
-- sign-in may change only an assignment a sign-in wrote; a role an admin
-- assigned by hand is never changed by a sign-in.
-- Existing rows read as assigned by hand (false): their origin is not
-- recorded, and keeping a role is the safe direction for an unknown one.
-- Additive: one column with a default, no data written.
ALTER TABLE "principal_role_assignments"
  ADD COLUMN IF NOT EXISTS "granted_by_sso" boolean DEFAULT false NOT NULL;
