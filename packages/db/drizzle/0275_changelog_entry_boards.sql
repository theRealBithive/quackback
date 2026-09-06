-- Which products a changelog entry is about. Boards are how a workspace models
-- its products (each one routes to its own tracker project), and the roadmap
-- already lets a reader narrow to one; the changelog could not, so a customer
-- of one product read the release notes of all of them.
--
-- M:N because a release routinely spans products, and because "no row at all"
-- is a meaningful third state rather than a gap: an entry with no product is a
-- cross-product announcement and stays visible under every filter.
--
-- The foreign keys are declared inline rather than added by a following
-- ALTER TABLE, which is what drizzle-kit would have generated. A bare
-- `ADD CONSTRAINT` has no `IF NOT EXISTS` form, so it errors on replay and
-- makes the whole file unsafe to replay — which collapses the fleet's
-- gap-heal window (policy/migration-contract/replay-safety.ts, and
-- fleet/__tests__/migrator-gap-heal.test.ts, which measures the window).
-- Inline, the entire file is absorbed by `IF NOT EXISTS` / `ON CONFLICT` and
-- a replay is a genuine no-op.
CREATE TABLE IF NOT EXISTS "changelog_entry_boards" (
	"board_id" uuid NOT NULL,
	"changelog_entry_id" uuid NOT NULL,
	CONSTRAINT "changelog_entry_boards_pk" PRIMARY KEY("board_id","changelog_entry_id"),
	CONSTRAINT "changelog_entry_boards_entry_fk" FOREIGN KEY ("changelog_entry_id") REFERENCES "public"."changelog_entries"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "changelog_entry_boards_board_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
-- The PK covers "every entry on this board"; this covers the other direction,
-- which is how the list reader loads the products of a page of entries.
CREATE INDEX IF NOT EXISTS "changelog_entry_boards_entry_idx" ON "changelog_entry_boards" USING btree ("changelog_entry_id");
--> statement-breakpoint
-- Backfill. An entry that already links shipped feedback is about the products
-- those posts belong to — the only evidence available, and leaving every
-- historical entry unassigned would make the filter useless on the day it
-- ships. An entry that links nothing stays unassigned, which is the
-- cross-product state rather than a gap.
--
-- ON CONFLICT keeps a fleet replay a no-op: an absorbed INSERT is replay-safe,
-- a bare one is not (policy/migration-contract/replay-safety.ts).
INSERT INTO "changelog_entry_boards" ("changelog_entry_id", "board_id")
SELECT DISTINCT cep."changelog_entry_id", p."board_id"
FROM "changelog_entry_posts" cep
JOIN "posts" p ON p."id" = cep."post_id"
WHERE p."deleted_at" IS NULL
ON CONFLICT DO NOTHING;
