-- The container an external item lives in: a GitLab project id, a GitHub
-- repository, a Jira project key. An issue id is only unique inside it —
-- GitLab numbers issues per project — so without this column two boards
-- routing to two projects would collide on the same `#42` and an inbound
-- webhook could act on the wrong post.
ALTER TABLE "post_external_links" ADD COLUMN IF NOT EXISTS "external_scope" varchar(200);
ALTER TABLE "ticket_external_links" ADD COLUMN IF NOT EXISTS "external_scope" varchar(200);

-- Backfill: every link that exists today was created against the single
-- project pinned in the integration's config, because until now there was
-- nowhere else for it to point. Recorded as the numeric id the config
-- stores, which is also what the provider reports on its webhooks and what
-- survives a project being renamed.
--
-- The UPDATEs sit in a DO block so a fleet replay is a no-op, in the shape
-- 0269 established. Each write fires only while the column is still null; a
-- link that already carries a scope makes the WHERE match nothing. A bare
-- UPDATE at the tip would collapse the gap-heal window.

-- @replay: guarded-by external_scope still being null; a link that already carries one is left untouched
DO $$
BEGIN
  UPDATE "post_external_links" AS l
  SET "external_scope" = i."config" ->> 'channelId'
  FROM "integrations" AS i
  WHERE l."integration_id" = i."id"
    AND l."external_scope" IS NULL
    AND i."config" ->> 'channelId' IS NOT NULL;

  UPDATE "ticket_external_links" AS l
  SET "external_scope" = i."config" ->> 'channelId'
  FROM "integrations" AS i
  WHERE l."integration_id" = i."id"
    AND l."external_scope" IS NULL
    AND i."config" ->> 'channelId' IS NOT NULL;
END $$;

-- The reverse lookup an inbound webhook performs.
CREATE INDEX IF NOT EXISTS "post_external_links_type_external_scope_idx"
  ON "post_external_links" ("integration_type", "external_id", "external_scope");
CREATE INDEX IF NOT EXISTS "ticket_external_links_type_external_scope_idx"
  ON "ticket_external_links" ("integration_type", "external_id", "external_scope");
