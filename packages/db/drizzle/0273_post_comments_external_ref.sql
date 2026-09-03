-- Provenance for a comment imported from a linked external issue (a GitLab
-- note, say). NULL on everything written inside Quackback.
ALTER TABLE "post_comments" ADD COLUMN IF NOT EXISTS "external_integration_type" varchar(50);
ALTER TABLE "post_comments" ADD COLUMN IF NOT EXISTS "external_id" text;

-- Idempotency: a redelivered provider webhook cannot post the same remote
-- comment twice. Partial, so ordinary comments (both columns NULL) are not
-- covered by it.
CREATE UNIQUE INDEX IF NOT EXISTS "post_comments_external_unique"
  ON "post_comments" ("external_integration_type", "external_id")
  WHERE "external_id" IS NOT NULL;
