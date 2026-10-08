/**
 * What the mutation gate is declared to grade.
 *
 * B4 Mutants are generated only for code this change touched, and the run finishes
 *    within a stated time budget.
 * B6 An equivalence record excuses exactly one mutation at one location. It cannot
 *    silence a different mutation, nor the same one once the line has changed.
 *
 * The manifest is a declaration, not a measurement: an entry asserts that the
 * suites it names pin that file on their own. So the list can be wrong in two
 * directions, and only one of them is loud. A file whose suites do not actually
 * pin it turns the next change to it red, which is the point. A file *removed*
 * from the list turns nothing red at all — the gate would simply grade less and
 * still pass, exactly the way narrowing `coverage.include` makes the coverage
 * gate green by measuring less.
 *
 * This module is the counterweight: it asserts the whole list, so a removal is a
 * red test rather than a shorter report. It is the same device as
 * `coverage-scope.test.ts`, for the same reason.
 *
 * Growing the list is meant to be easy and is meant to leave a trace: add the
 * entry, add it here, and the diff shows both.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { readManifest } from '../mutation-policy'

function manifest() {
  const file = path.resolve(import.meta.dirname, '../mutation-manifest.json')
  return readManifest(JSON.parse(readFileSync(file, 'utf8')))
}

describe('the files the mutation gate is declared to grade (B4)', () => {
  it('declares every mutation-graded file with the suites that pin it, and nothing else', () => {
    expect(manifest().graded).toEqual([
      { file: 'scripts/audit-policy.ts', suites: ['scripts/__tests__/audit-policy.test.ts'] },
      { file: 'scripts/i18n-policy.ts', suites: ['scripts/__tests__/i18n-policy.test.ts'] },
      {
        file: 'scripts/diff-coverage-policy.ts',
        suites: ['scripts/__tests__/diff-coverage-policy.test.ts'],
      },
      {
        file: 'scripts/mutation-policy.ts',
        suites: ['scripts/__tests__/mutation-policy.test.ts'],
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/url.ts',
        suites: ['apps/web/src/integrations/gitlab/server/__tests__/url.test.ts'],
      },
      {
        file: 'apps/web/src/lib/server/integrations/external-link-scope.ts',
        suites: ['apps/web/src/lib/server/integrations/__tests__/external-link-scope.test.ts'],
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/inbound.ts',
        suites: [
          'apps/web/src/integrations/gitlab/server/__tests__/inbound.test.ts',
          'apps/web/src/lib/server/integrations/__tests__/signature-matrix.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/server/integrations/board-routing-policy.ts',
        suites: ['apps/web/src/lib/server/integrations/__tests__/board-routing-policy.test.ts'],
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/post-source.ts',
        suites: ['apps/web/src/integrations/gitlab/server/__tests__/post-source.db.test.ts'],
      },
      {
        file: 'apps/web/src/lib/server/events/resolvers/issue-move-policy.ts',
        suites: ['apps/web/src/lib/server/events/resolvers/__tests__/issue-move-policy.test.ts'],
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/issue-move.ts',
        suites: ['apps/web/src/integrations/gitlab/server/__tests__/issue-move.db.test.ts'],
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/archive.ts',
        suites: ['apps/web/src/integrations/gitlab/server/__tests__/archive.test.ts'],
      },
      {
        file: 'apps/web/src/lib/server/events/resolvers/issue-move.resolver.ts',
        suites: [
          'apps/web/src/lib/server/events/resolvers/__tests__/issue-move.resolver.db.test.ts',
          'apps/web/src/lib/server/events/__tests__/issue-move-wiring.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/shared/roles.ts',
        suites: [
          'apps/web/src/lib/shared/__tests__/roles.test.ts',
          'apps/web/src/lib/server/functions/__tests__/auth-scope.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/server/auth/session-audience.ts',
        suites: [
          'apps/web/src/lib/server/auth/__tests__/session-scope-on-create.test.ts',
          'apps/web/src/lib/server/auth/__tests__/session-audience.test.ts',
          'apps/web/src/lib/server/auth/__tests__/session-audience-heal.db.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/server/auth/client-ip.ts',
        suites: [
          'apps/web/src/lib/server/auth/__tests__/client-ip.test.ts',
          'apps/web/src/lib/server/auth/__tests__/client-ip-wiring.test.ts',
          'apps/web/src/lib/server/functions/__tests__/anon-vote-client-ip.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/server/auth/http-disabled-paths.ts',
        suites: ['apps/web/src/lib/server/auth/__tests__/http-disabled-paths.test.ts'],
      },
      {
        file: 'apps/web/src/lib/server/auth/sso-managed-email.ts',
        suites: [
          'apps/web/src/lib/server/auth/__tests__/sso-managed-email.test.ts',
          'apps/web/src/lib/server/domains/users/__tests__/user-update.db.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/server/runtime-error-log.ts',
        suites: ['apps/web/src/lib/server/__tests__/runtime-error-log.test.ts'],
      },
      {
        file: 'apps/web/src/lib/shared/unsubscribe-token.ts',
        suites: ['apps/web/src/lib/shared/__tests__/unsubscribe-token.test.ts'],
      },
      {
        file: 'apps/web/src/lib/server/functions/one-click-unsubscribe.ts',
        suites: ['apps/web/src/lib/server/functions/__tests__/one-click-unsubscribe.test.ts'],
      },
      {
        file: 'packages/email/src/list-unsubscribe.ts',
        suites: ['packages/email/src/__tests__/list-unsubscribe.test.ts'],
      },
      {
        file: 'apps/web/src/lib/server/realtime/stream-token.ts',
        suites: ['apps/web/src/lib/server/realtime/__tests__/stream-token.test.ts'],
      },
      {
        file: 'apps/web/src/lib/server/functions/workspace.ts',
        suites: ['apps/web/src/lib/server/functions/__tests__/workspace-api-access.test.ts'],
      },
      {
        file: 'apps/web/src/lib/client/mutations/inbox-list-cache.ts',
        suites: [
          'apps/web/src/lib/client/mutations/__tests__/inbox-list-cache.test.ts',
          'apps/web/src/lib/client/mutations/__tests__/inbox-list-cache-collision.test.tsx',
        ],
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/token-renewal.ts',
        suites: ['apps/web/src/integrations/gitlab/server/__tests__/oauth-refresh.test.ts'],
      },
      {
        file: 'apps/web/src/lib/client/failure-message.ts',
        suites: [
          'apps/web/src/components/admin/feedback/detail/__tests__/use-metadata-handlers.test.tsx',
        ],
      },
      {
        file: 'apps/web/src/components/admin/feedback/detail/use-metadata-handlers.ts',
        suites: [
          'apps/web/src/components/admin/feedback/detail/__tests__/use-metadata-handlers.test.tsx',
        ],
      },
      {
        file: 'apps/web/src/lib/server/domains/changelog/changelog-board-filter.ts',
        suites: [
          'apps/web/src/lib/server/domains/changelog/__tests__/changelog-board-filter.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/server/domains/changelog/changelog-board.service.ts',
        suites: [
          'apps/web/src/lib/server/domains/changelog/__tests__/changelog-board.db.test.ts',
          'apps/web/src/lib/server/domains/changelog/__tests__/changelog-board-shortcut.test.ts',
          'apps/web/src/lib/server/domains/changelog/__tests__/changelog-board-write.db.test.ts',
        ],
      },
      {
        file: 'apps/web/src/test/render-with-intl.tsx',
        suites: ['apps/web/src/test/__tests__/render-with-intl.test.tsx'],
      },
      {
        file: 'apps/web/src/lib/shared/language-choice.ts',
        suites: ['apps/web/src/lib/shared/__tests__/language-choice.test.ts'],
      },
      {
        file: 'apps/web/src/components/settings/language-card.tsx',
        suites: ['apps/web/src/components/settings/__tests__/language-card.test.tsx'],
      },
      {
        file: 'apps/web/src/lib/shared/auth-block-messages.ts',
        suites: ['apps/web/src/lib/shared/__tests__/auth-block-messages.test.ts'],
      },
      {
        file: 'apps/web/src/components/auth/auth-block-message.ts',
        suites: ['apps/web/src/components/auth/__tests__/auth-block-message.test.tsx'],
      },
      {
        file: 'apps/web/src/lib/shared/notifications/message-ids.ts',
        suites: ['apps/web/src/lib/shared/notifications/__tests__/catalog-ids.test.ts'],
      },
      {
        file: 'apps/web/src/lib/server/events/hook-token.ts',
        suites: ['apps/web/src/lib/server/events/__tests__/hook-token.test.ts'],
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/hook.ts',
        suites: [
          'apps/web/src/integrations/gitlab/server/__tests__/hook.test.ts',
          'apps/web/src/integrations/gitlab/server/__tests__/hook-triage-trigger.test.ts',
        ],
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/functions.ts',
        suites: ['apps/web/src/integrations/gitlab/server/__tests__/functions.test.ts'],
      },
      {
        file: 'apps/web/src/components/admin/settings/integrations/oauth-connection-actions.tsx',
        suites: [
          'apps/web/src/components/admin/settings/integrations/__tests__/oauth-connection-actions.test.tsx',
        ],
      },
      {
        file: 'apps/web/src/integrations/gitlab/ui/gitlab-connection-actions.tsx',
        suites: [
          'apps/web/src/components/admin/settings/integrations/__tests__/oauth-connection-actions.test.tsx',
        ],
      },
      {
        file: 'apps/web/src/lib/server/domains/posts/post.portal-default-status.ts',
        suites: [
          'apps/web/src/lib/server/domains/boards/__tests__/board-public-post-count.db.test.ts',
          'apps/web/src/lib/server/domains/posts/__tests__/post-public.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/server/auth/mcp-dcr-scopes.ts',
        suites: [
          'apps/web/src/lib/server/auth/__tests__/mcp-dcr-scopes.test.ts',
          'apps/web/src/routes/api/auth/__tests__/dcr-redirect-restore.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/server/auth/mcp-plugin-resource.ts',
        suites: ['apps/web/src/lib/server/auth/__tests__/mcp-plugin-resource.test.ts'],
      },
      {
        file: 'apps/web/src/lib/shared/mcp-consent-scopes.ts',
        suites: [
          'apps/web/src/lib/shared/__tests__/mcp-consent-scopes.test.ts',
          'apps/web/src/routes/oauth/__tests__/consent-scope-view.test.ts',
          'apps/web/src/routes/oauth/__tests__/consent-page.test.tsx',
        ],
      },
      {
        file: 'apps/web/src/lib/server/mcp/protected-resource-metadata.ts',
        suites: ['apps/web/src/lib/server/mcp/__tests__/oauth-challenge.test.ts'],
      },
      {
        file: 'apps/web/src/lib/client/start-provider-link.ts',
        suites: [
          'apps/web/src/lib/client/__tests__/start-provider-link.test.ts',
          'apps/web/src/components/auth/__tests__/portal-auth-form-inline.link-conflict.test.tsx',
        ],
      },
      {
        file: 'apps/web/src/lib/server/auth/ensure-mcp-oauth-resource.ts',
        suites: [
          'apps/web/src/lib/server/auth/__tests__/ensure-mcp-oauth-resource.test.ts',
          'apps/web/src/lib/server/auth/__tests__/oauth-client-resource-cascade.db.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/server/domains/settings/widget-install-pairing.ts',
        suites: [
          'apps/web/src/lib/server/domains/settings/__tests__/widget-install-pairing.test.ts',
          'apps/web/src/lib/server/domains/settings/__tests__/widget-install-pairing.db.test.ts',
        ],
      },
      {
        file: 'apps/web/src/routes/api/widget/install-context.ts',
        suites: ['apps/web/src/routes/api/widget/__tests__/install-context.test.ts'],
      },
      {
        file: 'apps/web/src/lib/shared/emoji-recommendations.ts',
        suites: ['apps/web/src/lib/shared/__tests__/emoji-recommendations.test.ts'],
      },
      {
        file: 'apps/web/src/components/ui/suggestion-list-keys.ts',
        suites: ['apps/web/src/components/ui/__tests__/suggestion-list-keys.test.ts'],
      },
      {
        file: 'apps/web/src/components/ui/highlight-query.tsx',
        suites: ['apps/web/src/components/ui/__tests__/highlight-query.test.tsx'],
      },
      {
        file: 'apps/web/src/lib/shared/content-emoji.ts',
        suites: ['apps/web/src/lib/shared/__tests__/content-emoji.test.ts'],
      },
      {
        file: 'apps/web/src/lib/shared/normalize-attribute-key.ts',
        suites: ['apps/web/src/lib/shared/__tests__/normalize-attribute-key.test.ts'],
      },
      {
        file: 'apps/web/src/lib/server/domains/attribute-definitions/attribute-definition.service.ts',
        suites: [
          'apps/web/src/lib/server/domains/attribute-definitions/__tests__/attribute-definition-rulebook.test.ts',
          'apps/web/src/lib/server/domains/attribute-definitions/__tests__/attribute-definition.service.test.ts',
        ],
      },
      {
        file: 'packages/db/src/permissions-mirror.ts',
        suites: [
          'packages/db/src/__tests__/permissions-mirror.test.ts',
          'apps/web/src/lib/shared/__tests__/permissions-catalogue-drift.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/server/domains/tickets/unique-slug.ts',
        suites: ['apps/web/src/lib/server/domains/tickets/__tests__/unique-slug.test.ts'],
      },
      {
        file: 'apps/web/src/lib/server/events/safe-dispatch.ts',
        suites: ['apps/web/src/lib/server/events/__tests__/safe-dispatch.test.ts'],
      },
      {
        file: 'apps/web/src/lib/server/utils/taxonomy.ts',
        suites: ['apps/web/src/lib/server/utils/__tests__/taxonomy.test.ts'],
      },
      {
        file: 'apps/web/src/lib/shared/schemas/taxonomy.ts',
        suites: ['apps/web/src/lib/shared/schemas/__tests__/taxonomy.test.ts'],
      },
      {
        file: 'apps/web/src/lib/shared/record.ts',
        suites: ['apps/web/src/lib/shared/__tests__/record.test.ts'],
      },
      {
        file: 'apps/web/src/lib/server/utils/next-position.ts',
        suites: [
          'apps/web/src/lib/server/utils/__tests__/next-position.test.ts',
          'apps/web/src/lib/server/utils/__tests__/next-position.db.test.ts',
        ],
      },
      {
        file: 'packages/ids/src/drizzle.ts',
        suites: ['packages/ids/src/__tests__/drizzle.test.ts'],
      },
      {
        file: 'apps/web/src/lib/client/conversation/reconcile-cached-thread.ts',
        suites: [
          'apps/web/src/lib/client/conversation/reconcile-cached-thread.test.ts',
          'apps/web/src/lib/client/conversation/__tests__/reconcile-cached-thread.contract.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/server/storage/serve-policy.ts',
        suites: [
          'apps/web/src/lib/server/storage/__tests__/serve-policy.test.ts',
          'apps/web/src/lib/server/storage/__tests__/serve-policy.contract.test.ts',
        ],
      },
      {
        file: 'apps/web/src/components/widget/widget-compose.ts',
        suites: [
          'apps/web/src/components/widget/__tests__/widget-compose.test.ts',
          'apps/web/src/components/widget/__tests__/widget-compose-board.contract.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/server/utils/sse.ts',
        suites: [
          'apps/web/src/lib/server/utils/__tests__/sse.test.ts',
          'apps/web/src/lib/server/utils/__tests__/sse-idle-timeout.contract.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/shared/oidc-request.ts',
        suites: ['apps/web/src/lib/shared/__tests__/oidc-request.test.ts'],
      },
      {
        file: 'apps/web/src/lib/shared/utils/is-empty-tiptap-doc.ts',
        suites: ['apps/web/src/lib/shared/utils/__tests__/is-empty-tiptap-doc.test.ts'],
      },
      {
        file: 'apps/web/src/lib/shared/conversation/message-permissions.ts',
        suites: ['apps/web/src/lib/server/policy/__tests__/message-edit-delete.contract.test.ts'],
      },
      {
        file: 'apps/web/src/components/conversation/message-edit.ts',
        suites: [
          'apps/web/src/components/conversation/__tests__/agent-message-bubble.test.tsx',
          'apps/web/src/components/conversation/__tests__/agent-thread-message-edit.contract.test.tsx',
        ],
      },
      {
        file: 'apps/web/src/lib/server/policy/conversation.ts',
        suites: [
          'apps/web/src/lib/server/policy/__tests__/conversation.test.ts',
          'apps/web/src/lib/server/policy/__tests__/message-edit-delete.contract.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/shared/post-template.ts',
        suites: ['apps/web/src/lib/shared/__tests__/post-template.test.ts'],
      },
      {
        file: 'apps/web/src/lib/client/hooks/use-post-template-prefill.ts',
        suites: [
          'apps/web/src/lib/client/hooks/__tests__/use-post-template-prefill.test.tsx',
          'apps/web/src/components/admin/settings/__tests__/post-template-real-editor.test.tsx',
        ],
      },
      {
        file: 'apps/web/src/lib/shared/widget-visible-board.ts',
        suites: ['apps/web/src/lib/shared/__tests__/widget-visible-board.test.ts'],
      },
      {
        file: 'apps/web/src/components/ui/format-number.ts',
        suites: [
          'apps/web/src/components/ui/__tests__/format-number.test.tsx',
          'apps/web/src/components/ui/__tests__/format-number.batch-l.contract.test.tsx',
        ],
      },
      {
        file: 'apps/web/src/components/ui/local-date.tsx',
        suites: [
          'apps/web/src/components/ui/__tests__/local-date.batch-l.contract.test.tsx',
          'apps/web/src/components/ui/__tests__/local-date-hydration.test.tsx',
        ],
      },
      {
        file: 'apps/web/src/components/ui/time-ago.tsx',
        suites: [
          'apps/web/src/components/ui/__tests__/time-ago.batch-l.contract.test.tsx',
          'apps/web/src/components/ui/__tests__/time-ago.contract.test.tsx',
          'apps/web/src/components/ui/__tests__/time-ago-hydration.test.tsx',
        ],
      },
      {
        file: 'apps/web/src/lib/server/content/magic-bytes.ts',
        suites: [
          'apps/web/src/lib/server/content/__tests__/magic-bytes.test.ts',
          'apps/web/src/lib/server/content/__tests__/magic-bytes.batch-h.contract.test.ts',
          'apps/web/src/lib/server/__tests__/upload-media.batch-h.contract.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/shared/storage-config.ts',
        suites: [
          'apps/web/src/lib/shared/__tests__/storage-config.batch-h.contract.test.ts',
          'apps/web/src/lib/server/__tests__/upload-media.batch-h.contract.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/server/storage/byte-range.ts',
        suites: [
          'apps/web/src/lib/server/storage/__tests__/byte-range.batch-h.contract.test.ts',
          'apps/web/src/routes/api/storage/__tests__/storage-range.batch-h.contract.test.ts',
        ],
      },
      {
        file: 'apps/web/src/routes/api/portal/upload.ts',
        suites: [
          'apps/web/src/routes/api/portal/__tests__/upload.test.ts',
          'apps/web/src/routes/api/portal/__tests__/upload.batch-h.contract.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/server/events/emit.ts',
        suites: [
          'apps/web/src/lib/server/events/__tests__/emit.test.ts',
          'apps/web/src/lib/server/events/__tests__/event-reactions.test.ts',
          'apps/web/src/lib/server/events/__tests__/event-reactions-contract.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/server/events/event-reactions.ts',
        suites: [
          'apps/web/src/lib/server/events/__tests__/event-reactions.test.ts',
          'apps/web/src/lib/server/events/__tests__/event-reactions-contract.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/server/events/event-reactions-queue.ts',
        suites: [
          'apps/web/src/lib/server/events/__tests__/event-reactions.test.ts',
          'apps/web/src/lib/server/events/__tests__/event-reactions-contract.test.ts',
        ],
      },
      {
        file: 'apps/web/src/lib/server/events/event-summaries-queue.ts',
        suites: [
          'apps/web/src/lib/server/events/__tests__/event-reactions.test.ts',
          'apps/web/src/lib/server/events/__tests__/event-reactions-contract.test.ts',
        ],
      },
    ])
  })

  it('names a suite that exists for every entry', () => {
    // A renamed suite makes vitest match nothing, which the gate refuses as a
    // run that measured nothing — but only once someone changes that file.
    // Here it is caught on every run.
    for (const entry of manifest().graded) {
      for (const suite of entry.suites) {
        const absolute = path.resolve(import.meta.dirname, '../..', suite)
        expect(() => readFileSync(absolute, 'utf8'), `${entry.file} names ${suite}`).not.toThrow()
      }
    }
  })
})

describe('the mutations excused as equivalent (B6)', () => {
  it('excuses exactly these mutations, each with a reason', () => {
    expect(manifest().equivalents).toEqual([
      {
        file: 'apps/web/src/integrations/gitlab/server/inbound.ts',
        mutator: 'ConditionalExpression',
        line: 'if (!state) return null',
        replacement: 'false',
        why: expect.stringContaining('the next line does not already decide'),
      },
      {
        file: 'scripts/diff-coverage-policy.ts',
        mutator: 'EqualityOperator',
        line: 'if (highest === undefined || highest < count) known.executions.set(line, count)',
        replacement: 'highest <= count',
        why: expect.stringContaining('same number it replaced'),
      },
      {
        file: 'scripts/diff-coverage-policy.ts',
        mutator: 'EqualityOperator',
        line: 'if (best === undefined || best < count) executions.set(line, count)',
        replacement: 'best <= count',
        why: expect.stringContaining('equal value'),
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/post-source.ts',
        mutator: 'ObjectLiteral',
        line: "const log = logger.child({ component: 'gitlab-post-source' })",
        replacement: '{}',
        why: expect.stringContaining('metadata on a log line'),
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/post-source.ts',
        mutator: 'StringLiteral',
        line: "const log = logger.child({ component: 'gitlab-post-source' })",
        replacement: '""',
        why: expect.stringContaining('log metadata'),
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/post-source.ts',
        mutator: 'ObjectLiteral',
        line: '.select({ id: postExternalLinks.id })',
        replacement: '{}',
        why: expect.stringContaining('never read'),
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/archive.ts',
        mutator: 'ConditionalExpression',
        line: 'if (ctx.externalUrl) {',
        replacement: 'true',
        why: expect.stringContaining('the catch beside it absorbs'),
      },
      {
        file: 'apps/web/src/lib/server/events/resolvers/issue-move.resolver.ts',
        mutator: 'ConditionalExpression',
        line: 'const rule = rulesFromMappings(rows).find((r) => r.boardId === boardId)',
        replacement: 'true',
        why: expect.stringContaining('no stored row makes the predicate decide'),
      },
      {
        file: 'apps/web/src/lib/server/events/resolvers/issue-move.resolver.ts',
        mutator: 'ConditionalExpression',
        line: 'if (links.length === 0) return []',
        replacement: 'false',
        why: expect.stringContaining('Only the number of queries changes'),
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/issue-move.ts',
        mutator: 'ObjectLiteral',
        line: "const log = logger.child({ component: 'gitlab-issue-move' })",
        replacement: '{}',
        why: expect.stringContaining('component name is metadata'),
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/issue-move.ts',
        mutator: 'StringLiteral',
        line: "const log = logger.child({ component: 'gitlab-issue-move' })",
        replacement: '""',
        why: expect.stringContaining('component name is metadata'),
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/issue-move.ts',
        mutator: 'ObjectLiteral',
        line: "log.error({ err: error, link_id: linkId, to_project_id: toProjectId }, 'issue move threw')",
        replacement: '{}',
        why: expect.stringContaining('field set is metadata'),
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/issue-move.ts',
        mutator: 'StringLiteral',
        line: "log.error({ err: error, link_id: linkId, to_project_id: toProjectId }, 'issue move threw')",
        replacement: '""',
        why: expect.stringContaining('message is metadata'),
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/issue-move.ts',
        mutator: 'ObjectLiteral',
        line: "log.error({ link_id: linkId, to_project_id: toProjectId }, 'move answered without an iid')",
        replacement: '{}',
        why: expect.stringContaining('field set is metadata'),
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/issue-move.ts',
        mutator: 'StringLiteral',
        line: "log.error({ link_id: linkId, to_project_id: toProjectId }, 'move answered without an iid')",
        replacement: '""',
        why: expect.stringContaining('own error text, which a test does assert'),
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/issue-move.ts',
        mutator: 'ObjectLiteral',
        line: '{ link_id: linkId, from_project_id: fromProjectId, to_project_id: toProjectId },',
        replacement: '{}',
        why: expect.stringContaining('field set is metadata'),
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/issue-move.ts',
        mutator: 'StringLiteral',
        line: "'issue moved'",
        replacement: '""',
        why: expect.stringContaining('message is metadata'),
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/issue-move.ts',
        mutator: 'ObjectLiteral',
        line: '{ status_code: status, link_id: linkId, to_project_id: toProjectId, body },',
        replacement: '{}',
        why: expect.stringContaining('field set is metadata'),
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/issue-move.ts',
        mutator: 'StringLiteral',
        line: "'move refused'",
        replacement: '""',
        why: expect.stringContaining('message is metadata'),
      },
      {
        file: 'apps/web/src/lib/server/domains/changelog/changelog-board.service.ts',
        mutator: 'ConditionalExpression',
        line: 'if (filter.boardIds.length === 0) return sql`NOT ${assigned}`',
        replacement: 'false',
        why: expect.stringContaining('the same predicate written twice'),
      },
      {
        file: 'apps/web/src/components/settings/language-card.tsx',
        mutator: 'StringLiteral',
        line: "defaultMessage: 'Language saved.',",
        replacement: '""',
        why: expect.stringContaining('the catalogue always wins'),
      },
      {
        file: 'apps/web/src/components/settings/language-card.tsx',
        mutator: 'StringLiteral',
        line: "defaultMessage: 'Your language could not be saved. Please try again.',",
        replacement: '""',
        why: expect.stringContaining('the catalogue always wins'),
      },
      {
        file: 'apps/web/src/components/settings/language-card.tsx',
        mutator: 'StringLiteral',
        line: "defaultMessage: 'Interface language',",
        replacement: '""',
        why: expect.stringContaining('the catalogue always wins'),
      },
      {
        file: 'apps/web/src/components/settings/language-card.tsx',
        mutator: 'ObjectLiteral',
        line: "style={{ animationDelay: '225ms' }}",
        replacement: '{}',
        why: expect.stringContaining('asserts the line against itself'),
      },
      {
        file: 'apps/web/src/components/settings/language-card.tsx',
        mutator: 'StringLiteral',
        line: "style={{ animationDelay: '225ms' }}",
        replacement: '""',
        why: expect.stringContaining('fades in with its siblings'),
      },
      {
        file: 'apps/web/src/components/auth/auth-block-message.ts',
        mutator: 'StringLiteral',
        line: "'Sign-in failed. Try again or contact your administrator if the problem persists.',",
        replacement: '""',
        why: expect.stringContaining('the catalogue always wins'),
      },
      {
        file: 'scripts/i18n-policy.ts',
        mutator: 'Regex',
        line: 'const EXCUSE = /^\\s*i18n-allow\\b\\s*:?\\s*(.*)$/s',
        replacement: '/^\\s*i18n-allow\\b\\s*:?\\s*(.*)/s',
        why: expect.stringContaining('the only use of `matched[1]` trims it'),
      },
      {
        file: 'scripts/i18n-policy.ts',
        mutator: 'ArithmeticOperator',
        line: "const before = text.slice(text.lastIndexOf('\\n', start - 1) + 1, start)",
        replacement: 'start + 1',
        why: expect.stringContaining('a comment opens with two characters'),
      },
      {
        file: 'scripts/i18n-policy.ts',
        mutator: 'ConditionalExpression',
        line: 'const after = text.slice(end, lineEnd < 0 ? text.length : lineEnd)',
        replacement: 'false',
        why: expect.stringContaining('nothing can ask the question'),
      },
      {
        file: 'scripts/i18n-policy.ts',
        mutator: 'EqualityOperator',
        line: 'const after = text.slice(end, lineEnd < 0 ? text.length : lineEnd)',
        replacement: 'lineEnd <= 0',
        why: expect.stringContaining('the one value this search cannot return'),
      },
      {
        file: 'scripts/i18n-policy.ts',
        mutator: 'StringLiteral',
        line: "if (SHOWING_OBJECTS.has(c.object.name ?? '')) return true",
        replacement: '"Stryker was here!"',
        why: expect.stringContaining('window.self.alert'),
      },
      {
        file: 'scripts/i18n-policy.ts',
        mutator: 'StringLiteral',
        line: "return SHOWING_FUNCTIONS.has(c.property.name ?? '')",
        replacement: '"Stryker was here!"',
        why: expect.stringContaining("toast['error']"),
      },
      {
        file: 'scripts/i18n-policy.ts',
        mutator: 'ConditionalExpression',
        line: "if (node.type === 'BinaryExpression') {",
        replacement: 'true',
        why: expect.stringContaining('a unary plus, which has no `left` and no `right`'),
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/hook.ts',
        mutator: 'ObjectLiteral',
        line: "const log = logger.child({ component: 'gitlab' })",
        replacement: '{}',
        why: "The component name is metadata on a log line and reaches no branch, no return value and no request. The operator-facing content of the hook's log lines — the project, the status and GitLab's answer — is asserted in hook.test.ts; the child's name is the one field a test could only read back from the logger it just configured.",
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/hook.ts',
        mutator: 'StringLiteral',
        line: "const log = logger.child({ component: 'gitlab' })",
        replacement: '""',
        why: 'Same line, same reason: the component name is log metadata, not behaviour, and the payload of every line the hook writes is asserted separately.',
      },
      {
        file: 'apps/web/src/components/admin/settings/integrations/oauth-connection-actions.tsx',
        mutator: 'StringLiteral',
        line: "window.history.replaceState({}, '', url.toString())",
        replacement: '"Stryker was here!"',
        why: "The second argument of history.replaceState is the entry's title, which the HTML specification tells browsers to ignore and no browser reads. The URL is the third argument and is asserted; nothing observable — not the location, not the history length, not the document title — changes with the second.",
      },
      {
        file: 'apps/web/src/routes/api/widget/install-context.ts',
        mutator: 'OptionalChaining',
        line: "if (forwarded) return forwarded.split(',')[0]?.trim() === 'https'",
        replacement: "forwarded.split(',')[0].trim",
        why: expect.stringContaining(
          'The guard above makes the header a non-empty string, and String'
        ),
      },
      {
        file: 'apps/web/src/routes/api/widget/install-context.ts',
        mutator: 'ObjectLiteral',
        line: "const log = logger.child({ component: 'widget-install-context' })",
        replacement: '{}',
        why: expect.stringContaining(
          'The component name is metadata on a log line and reaches no branch, no'
        ),
      },
      {
        file: 'apps/web/src/routes/api/widget/install-context.ts',
        mutator: 'StringLiteral',
        line: "const log = logger.child({ component: 'widget-install-context' })",
        replacement: '""',
        why: expect.stringContaining(
          'Same line, same reason: the component name is log metadata, not behavi'
        ),
      },
      {
        file: 'apps/web/src/lib/server/domains/settings/widget-install-pairing.ts',
        mutator: 'StringLiteral',
        line: "return createHash('sha256').update(code.trim(), 'utf8').digest('hex')",
        replacement: '""',
        why: expect.stringContaining(
          'Node reads a falsy input encoding as its default, utf8, so the digest '
        ),
      },
      {
        file: 'apps/web/src/lib/server/domains/settings/widget-install-pairing.ts',
        mutator: 'ObjectLiteral',
        line: "const log = logger.child({ component: 'widget-install-pairing' })",
        replacement: '{}',
        why: expect.stringContaining(
          'The component name is metadata on a log line and reaches no branch, no'
        ),
      },
      {
        file: 'apps/web/src/lib/server/domains/settings/widget-install-pairing.ts',
        mutator: 'StringLiteral',
        line: "const log = logger.child({ component: 'widget-install-pairing' })",
        replacement: '""',
        why: expect.stringContaining(
          'Same line, same reason: the component name is log metadata, not behavi'
        ),
      },
      {
        file: 'apps/web/src/lib/shared/mcp-consent-scopes.ts',
        mutator: 'Regex',
        line: 'return raw.split(/[+\\s]+/).filter(Boolean)',
        replacement: '/[+\\s]/',
        why: expect.stringContaining(
          'Splitting on a single separator instead of a run of them dif'
        ),
      },
      {
        file: 'apps/web/src/lib/shared/mcp-consent-scopes.ts',
        mutator: 'StringLiteral',
        line: "if (isFullAsCatalogue(params.scope ?? '')) return [...MCP_FIRST_CONNECT_SCOPES]",
        replacement: '"Stryker was here!"',
        why: expect.stringContaining(
          'The fallback is only read when the scope parameter is absent'
        ),
      },
      {
        file: 'apps/web/src/lib/server/domains/attribute-definitions/attribute-definition.service.ts',
        mutator: 'ObjectLiteral',
        line: 'const log = logger.child({ component: logComponent })',
        replacement: '{}',
        why: expect.stringContaining("The child logger's component name is log"),
      },
      {
        file: 'apps/web/src/lib/shared/emoji-recommendations.ts',
        mutator: 'OptionalChaining',
        line: 'raw = storage()?.getItem(EMOJI_RECENT_STORAGE_KEY) ?? null',
        replacement: 'storage().getItem',
        why: expect.stringContaining('storage() returns null only when window '),
      },
      {
        file: 'apps/web/src/lib/shared/emoji-recommendations.ts',
        mutator: 'BlockStatement',
        line: '} catch {',
        replacement: '{}',
        why: expect.stringContaining('Emptying the catch leaves raw at its ini'),
      },
      {
        file: 'apps/web/src/lib/shared/emoji-recommendations.ts',
        mutator: 'ConditionalExpression',
        line: 'if (!raw) return []',
        replacement: 'false',
        why: expect.stringContaining('Skipping the null/empty guard sends null'),
      },
      {
        file: 'apps/web/src/lib/shared/emoji-recommendations.ts',
        mutator: 'ConditionalExpression',
        line: 'if (!Array.isArray(parsed)) return []',
        replacement: 'false',
        why: expect.stringContaining('Without the array guard a parsed object,'),
      },
      {
        file: 'apps/web/src/lib/shared/emoji-recommendations.ts',
        mutator: 'OptionalChaining',
        line: 'storage()?.setItem(EMOJI_RECENT_STORAGE_KEY, JSON.stringify(next))',
        replacement: 'storage().setItem',
        why: expect.stringContaining('When storage() is null the mutant throws'),
      },
      {
        file: 'apps/web/src/lib/shared/emoji-recommendations.ts',
        mutator: 'UnaryOperator',
        line: 'const aRecent = a.emoji ? recents.indexOf(a.emoji) : -1',
        replacement: '+1',
        why: expect.stringContaining('The false arm of a.emoji ? … : -1 is unr'),
      },
      {
        file: 'apps/web/src/lib/shared/emoji-recommendations.ts',
        mutator: 'UnaryOperator',
        line: 'const bRecent = b.emoji ? recents.indexOf(b.emoji) : -1',
        replacement: '+1',
        why: expect.stringContaining('Same unreachable false arm for b: both o'),
      },
      {
        file: 'apps/web/src/lib/shared/emoji-recommendations.ts',
        mutator: 'ConditionalExpression',
        line: "if (typeof window === 'undefined') return null",
        replacement: 'false',
        why: expect.stringContaining('Never taking the guard evaluates window.'),
      },
      {
        file: 'apps/web/src/lib/shared/emoji-recommendations.ts',
        mutator: 'StringLiteral',
        line: "if (typeof window === 'undefined') return null",
        replacement: '""',
        why: expect.stringContaining('typeof never yields the empty string, so'),
      },
      {
        file: 'apps/web/src/lib/shared/emoji-recommendations.ts',
        mutator: 'ConditionalExpression',
        line: 'if (aRecent !== -1 || bRecent !== -1) {',
        replacement: 'true',
        why: expect.stringContaining('Entering the block when neither item is '),
      },
      {
        file: 'apps/web/src/lib/shared/emoji-recommendations.ts',
        mutator: 'ConditionalExpression',
        line: 'if (aRecent !== -1 || bRecent !== -1) {',
        replacement: 'false',
        why: expect.stringContaining('The second operand can only decide the e'),
      },
      {
        file: 'apps/web/src/lib/shared/emoji-recommendations.ts',
        mutator: 'EqualityOperator',
        line: 'if (aRecent !== -1 || bRecent !== -1) {',
        replacement: 'bRecent === -1',
        why: expect.stringContaining('Flipping the second comparison changes t'),
      },
      {
        file: 'apps/web/src/lib/shared/emoji-recommendations.ts',
        mutator: 'UnaryOperator',
        line: 'if (aRecent !== -1 || bRecent !== -1) {',
        replacement: '+1',
        why: expect.stringContaining('The -1 in the second comparison is reach'),
      },
      {
        file: 'apps/web/src/lib/shared/roles.ts',
        mutator: 'ConditionalExpression',
        line: "if (value === 'dashboard' || value === 'widget' || value === 'portal') return value",
        replacement: 'false',
        why: expect.stringContaining('The mutant drops the third operand, so a stored '),
      },
      {
        file: 'apps/web/src/lib/server/realtime/stream-token.ts',
        mutator: 'ConditionalExpression',
        line: 'if (dot <= 0) return null',
        replacement: 'false',
        why: expect.stringContaining('Skipping the guard only matters for a token whos'),
      },
      {
        file: 'apps/web/src/lib/server/realtime/stream-token.ts',
        mutator: 'EqualityOperator',
        line: 'if (dot <= 0) return null',
        replacement: 'dot < 0',
        why: expect.stringContaining("The two differ only when the last '.' sits at in"),
      },
      {
        file: 'apps/web/src/lib/server/realtime/stream-token.ts',
        mutator: 'ConditionalExpression',
        line: 'if (sep <= 0) return null',
        replacement: 'false',
        why: expect.stringContaining('A signed payload with no separator, or one start'),
      },
      {
        file: 'apps/web/src/lib/server/realtime/stream-token.ts',
        mutator: 'EqualityOperator',
        line: 'if (sep <= 0) return null',
        replacement: 'sep < 0',
        why: expect.stringContaining('The two differ only for a payload whose last sep'),
      },
      {
        file: 'apps/web/src/lib/server/realtime/stream-token.ts',
        mutator: 'BlockStatement',
        line: '} catch {',
        replacement: '{}',
        why: expect.stringContaining("`Buffer.from(string, 'base64url')` does not thro"),
      },
      {
        file: 'apps/web/src/lib/server/functions/workspace.ts',
        mutator: 'ObjectLiteral',
        line: "const log = logger.child({ component: 'workspace' })",
        replacement: '{}',
        why: expect.stringContaining('The component name is metadata on a log line. It'),
      },
      {
        file: 'apps/web/src/lib/server/functions/workspace.ts',
        mutator: 'StringLiteral',
        line: "const log = logger.child({ component: 'workspace' })",
        replacement: '""',
        why: expect.stringContaining('The component name is metadata on a log line. It'),
      },
      {
        file: 'apps/web/src/lib/server/functions/workspace.ts',
        mutator: 'StringLiteral',
        line: "log.debug('get current user role')",
        replacement: '""',
        why: expect.stringContaining('The message is metadata on a log line. It reache'),
      },
      {
        file: 'apps/web/src/lib/server/functions/workspace.ts',
        mutator: 'StringLiteral',
        line: "log.debug('no session')",
        replacement: '""',
        why: expect.stringContaining('The message is metadata on a log line. It reache'),
      },
      {
        file: 'apps/web/src/lib/server/functions/workspace.ts',
        mutator: 'StringLiteral',
        line: "log.debug('no principal')",
        replacement: '""',
        why: expect.stringContaining('The message is metadata on a log line. It reache'),
      },
      {
        file: 'apps/web/src/lib/server/functions/workspace.ts',
        mutator: 'ObjectLiteral',
        line: "log.debug({ role: principalRecord.role }, 'current user role')",
        replacement: '{}',
        why: expect.stringContaining('The field set is metadata on a log line. It reac'),
      },
      {
        file: 'apps/web/src/lib/server/functions/workspace.ts',
        mutator: 'StringLiteral',
        line: "log.debug({ role: principalRecord.role }, 'current user role')",
        replacement: '""',
        why: expect.stringContaining('The message is metadata on a log line. It reache'),
      },
      {
        file: 'apps/web/src/components/widget/widget-compose.ts',
        mutator: 'ConditionalExpression',
        line: 'lines.length === 0',
        replacement: 'false',
        why: expect.stringContaining('String.prototype.split always returns at least one'),
      },
      {
        file: 'apps/web/src/components/widget/widget-compose.ts',
        mutator: 'ArrayDeclaration',
        line: "? [{ type: 'paragraph' }]",
        replacement: '[]',
        why: expect.stringContaining('String.prototype.split always returns at least one'),
      },
      {
        file: 'apps/web/src/components/widget/widget-compose.ts',
        mutator: 'ObjectLiteral',
        line: "? [{ type: 'paragraph' }]",
        replacement: '{}',
        why: expect.stringContaining('String.prototype.split always returns at least one'),
      },
      {
        file: 'apps/web/src/components/widget/widget-compose.ts',
        mutator: 'StringLiteral',
        line: "? [{ type: 'paragraph' }]",
        replacement: '""',
        why: expect.stringContaining('String.prototype.split always returns at least one'),
      },
      {
        file: 'apps/web/src/lib/server/utils/sse.ts',
        mutator: 'ConditionalExpression',
        line: 'if (keepAlive) clearInterval(keepAlive)',
        replacement: 'true',
        why: expect.stringContaining('clearInterval(null) is specified to do nothing, so'),
      },
      {
        file: 'apps/web/src/lib/server/utils/sse.ts',
        mutator: 'ConditionalExpression',
        line: 'if (size === null || size <= 0) return',
        replacement: 'false',
        why: expect.stringContaining('JavaScript converts null to 0 in a numeric compari'),
      },
      {
        file: 'apps/web/src/lib/server/utils/sse.ts',
        mutator: 'OptionalChaining',
        line: 'const size = controller?.desiredSize',
        replacement: 'controller.desiredSize',
        why: expect.stringContaining('The ReadableStream start callback runs synchronous'),
      },
      {
        file: 'apps/web/src/lib/server/utils/sse.ts',
        mutator: 'ConditionalExpression',
        line: 'if (size !== undefined && size !== null && size <= 0) {',
        replacement: 'true',
        why: expect.stringContaining('ReadableStreamDefaultController.desiredSize is a n'),
      },
      {
        file: 'apps/web/src/lib/shared/utils/is-empty-tiptap-doc.ts',
        mutator: 'ConditionalExpression',
        line: 'if (!content || content.length === 0) return true',
        replacement: 'false',
        why: expect.stringContaining('With the length test removed, an empty array falls'),
      },
      {
        file: 'apps/web/src/lib/shared/utils/is-empty-tiptap-doc.ts',
        mutator: 'ConditionalExpression',
        line: 'if (!children || children.length === 0) return true',
        replacement: 'false',
        why: expect.stringContaining('With the length test removed, an empty children ar'),
      },
      {
        file: 'apps/web/src/components/conversation/message-edit.ts',
        mutator: 'StringLiteral',
        line: "const parent = message.ticketId ? 'ticket' : 'conversation'",
        replacement: '""',
        why: expect.stringContaining('writePermissionFor asks only whether the parent is'),
      },
      {
        file: 'apps/web/src/lib/client/hooks/use-post-template-prefill.ts',
        mutator: 'ConditionalExpression',
        line: 'if (previous === undefined || next === undefined) return previous === next',
        replacement: 'false',
        why: "This branch answers only when at least one template is undefined. Its value differs from `false` only when both are, and the effect runs with both undefined only on mount or when setDescription changes identity (the hook requires a stable setter). There the description is either null, empty or the author's own text with nothing inserted; mayReplaceDescription then writes null into an already empty description or refuses. No reader can tell an empty description from null, and no text is ever touched.",
      },
      {
        file: 'apps/web/src/lib/shared/post-template.ts',
        mutator: 'ConditionalExpression',
        line: 'if (description === null) return true',
        replacement: 'false',
        why: 'isEmptyTiptapDoc treats a missing document as empty, so for a null description the next line returns true as well. This line exists for the type checker, which needs description narrowed to a document before hasSameVisibleContent; no input can tell the two paths apart.',
      },
      {
        file: 'apps/web/src/lib/server/runtime-error-log.ts',
        mutator: 'ConditionalExpression',
        line: "if (original && typeof original === 'object' && accountedFor.has(original)) return",
        replacement: 'true',
        why: expect.stringContaining('The two type checks only narrow `original` for the'),
      },
      {
        file: 'apps/web/src/lib/server/runtime-error-log.ts',
        mutator: 'LogicalOperator',
        line: "if (original && typeof original === 'object' && accountedFor.has(original)) return",
        replacement: "original || typeof original === 'object'",
        why: expect.stringContaining('Same line, same reason: `original` is never nullis'),
      },
      {
        file: 'apps/web/src/lib/server/functions/one-click-unsubscribe.ts',
        mutator: 'ConditionalExpression',
        line: 'if (!request.body) return new Uint8Array()',
        replacement: 'false',
        why: expect.stringContaining('A request with no body is not a one-click request '),
      },
      {
        file: 'apps/web/src/lib/server/functions/one-click-unsubscribe.ts',
        mutator: 'ConditionalExpression',
        line: 'if (!body) return false',
        replacement: 'false',
        why: expect.stringContaining('A null body (over the cap) goes on to TextDecoder.'),
      },
      {
        file: 'apps/web/src/lib/server/functions/one-click-unsubscribe.ts',
        mutator: 'StringLiteral',
        line: "const contentType = request.headers.get('content-type') ?? ''",
        replacement: '"Stryker was here!"',
        why: expect.stringContaining("The fallback is read only by startsWith('multipart"),
      },
      {
        file: 'apps/web/src/lib/server/functions/one-click-unsubscribe.ts',
        mutator: 'BlockStatement',
        line: '} catch {',
        replacement: '{}',
        why: expect.stringContaining('With the block emptied the function resolves to un'),
      },
      {
        file: 'packages/email/src/list-unsubscribe.ts',
        mutator: 'ConditionalExpression',
        line: 'if (!unsubscribeUrl) return {}',
        replacement: 'false',
        why: expect.stringContaining('The guard spares a throw the catch below absorbs: '),
      },
      {
        file: 'apps/web/src/lib/server/auth/session-audience.ts',
        mutator: 'StringLiteral',
        line: "return /(?:^|;)\\s*(?:__Secure-)?better-auth\\.session_token=/.test(headers.get('cookie') ?? '')",
        replacement: '"Stryker was here!"',
        why: expect.stringContaining('The fallback stands in for a missing Cookie header'),
      },
      {
        file: 'apps/web/src/lib/server/auth/sso-managed-email.ts',
        mutator: 'BooleanLiteral',
        line: 'columns: { id: true },',
        replacement: 'false',
        why: expect.stringContaining('The lookup is read only for whether a row came bac'),
      },
      {
        file: 'apps/web/src/components/ui/local-date.tsx',
        mutator: 'ConditionalExpression',
        line: 'if (!formatter) {',
        replacement: 'true',
        why: 'The formatter cache only saves rebuilding an Intl formatter. Skipping the lookup or the store builds an identical formatter for the same locale and options, so every rendered string is the same; the only difference is how often a constructor runs, which no contract item speaks to.',
      },
      {
        file: 'apps/web/src/components/ui/local-date.tsx',
        mutator: 'CallExpression',
        line: 'firstRenderFormatters.set(key, formatter)',
        replacement: ';',
        why: 'The formatter cache only saves rebuilding an Intl formatter. Skipping the lookup or the store builds an identical formatter for the same locale and options, so every rendered string is the same; the only difference is how often a constructor runs, which no contract item speaks to.',
      },
      {
        file: 'apps/web/src/components/ui/local-date.tsx',
        mutator: 'ConditionalExpression',
        line: "if (date === null || date === undefined || date === '') return null",
        replacement: 'false',
        why: "Without this clause an undefined or empty value falls through to `new Date(undefined)` or `new Date('')`, both an Invalid Date, and the `isNaN` check on the next line returns null for exactly those inputs. No input reaches a different result.",
      },
      {
        file: 'apps/web/src/components/ui/local-date.tsx',
        mutator: 'StringLiteral',
        line: "if (date === null || date === undefined || date === '') return null",
        replacement: '"Stryker was here!"',
        why: 'Same as the clause beside it: an empty string that misses this check becomes an Invalid Date on the next line and returns null there. The only string that now matches early is one no caller passes, and it too would be an Invalid Date.',
      },
      {
        file: 'apps/web/src/components/ui/local-date.tsx',
        mutator: 'ArrowFunction',
        line: '() => false',
        replacement: '() => undefined',
        why: "The server snapshot is only read as 'hydrated or not' in a boolean position; undefined and false take the same branch everywhere it is used.",
      },
      {
        file: 'apps/web/src/components/ui/local-date.tsx',
        mutator: 'ArrowFunction',
        line: 'const subscribe = () => () => {}',
        replacement: '() => undefined',
        why: 'The store never changes, so the unsubscribe React receives does nothing either way; React accepts an undefined cleanup as no cleanup.',
      },
      {
        file: 'apps/web/src/components/ui/time-ago.tsx',
        mutator: 'ConditionalExpression',
        line: 'if (!formatter) {',
        replacement: 'true',
        why: 'The formatter cache only saves rebuilding an Intl formatter. Skipping the lookup or the store builds an identical formatter for the same locale and options, so every rendered string is the same; the only difference is how often a constructor runs, which no contract item speaks to.',
      },
      {
        file: 'apps/web/src/components/ui/time-ago.tsx',
        mutator: 'CallExpression',
        line: 'unitFormatters.set(key, formatter)',
        replacement: ';',
        why: 'The formatter cache only saves rebuilding an Intl formatter. Skipping the lookup or the store builds an identical formatter for the same locale and options, so every rendered string is the same; the only difference is how often a constructor runs, which no contract item speaks to.',
      },
      {
        file: 'apps/web/src/components/ui/time-ago.tsx',
        mutator: 'CallExpression',
        line: 'relativeFormatters.set(key, formatter)',
        replacement: ';',
        why: 'The formatter cache only saves rebuilding an Intl formatter. Skipping the lookup or the store builds an identical formatter for the same locale and options, so every rendered string is the same; the only difference is how often a constructor runs, which no contract item speaks to.',
      },
      {
        file: 'apps/web/src/components/ui/time-ago.tsx',
        mutator: 'ConditionalExpression',
        line: "const d = typeof date === 'string' ? new Date(date) : date",
        replacement: 'true',
        why: '`new Date(aDate)` copies the same instant, so converting a Date that was already a Date yields the same moment and the same label for every input the type allows (string or Date).',
      },
      {
        file: 'apps/web/src/components/ui/time-ago.tsx',
        mutator: 'ArrowFunction',
        line: 'if (ref.current && ref.current.textContent !== label) setRemount((n) => n + 1)',
        replacement: '() => undefined',
        why: 'The remount only exists to replace text that hydration kept from the server. The first call changes the key (0 to undefined), which is that replacement. After it React owns the text and `setTimeAgo` patches it on every later change, so a key that stops changing afterwards shows the same label.',
      },
      {
        file: 'apps/web/src/components/ui/time-ago.tsx',
        mutator: 'ArithmeticOperator',
        line: 'if (ref.current && ref.current.textContent !== label) setRemount((n) => n + 1)',
        replacement: 'n - 1',
        why: 'Any change of the key remounts the span; counting down changes it on every call exactly as counting up does.',
      },
      {
        file: 'apps/web/src/lib/server/content/magic-bytes.ts',
        mutator: 'ConditionalExpression',
        line: 'if (buf.length < offset + pattern.length) return false',
        replacement: 'false',
        why: "The length guard only spares the loop below from reading past the buffer, and a byte read past a Buffer's end is `undefined`, which never equals a pattern byte: the loop returns false for exactly the inputs the guard does.",
      },
      {
        file: 'apps/web/src/lib/server/content/magic-bytes.ts',
        mutator: 'ArithmeticOperator',
        line: 'if (buf.length < offset + pattern.length) return false',
        replacement: 'offset - pattern.length',
        why: 'Same guard, made weaker: whatever it lets through reaches the loop, where a read past the end is `undefined` and fails the comparison, so the answer is false either way.',
      },
      {
        file: 'apps/web/src/lib/server/content/magic-bytes.ts',
        mutator: 'BooleanLiteral',
        line: 'if (buf.length < offset + pattern.length) return false',
        replacement: 'true',
        why: 'Reached only from the EBML check with a buffer shorter than the four-byte magic (images are length-checked first). The next read is then at offset 4, past the end, which reads `undefined`, is no length marker, and returns null: a file that short is refused either way, measured with 0- and 3-byte buffers.',
      },
      {
        file: 'apps/web/src/lib/server/content/magic-bytes.ts',
        mutator: 'ConditionalExpression',
        line: 'buf.length >= 12 &&',
        replacement: 'true',
        why: "Upstream's WebP check: a buffer shorter than 12 bytes yields a slice shorter than four characters, which cannot equal 'WEBP', so the length test decides nothing the comparison does not.",
      },
      {
        file: 'apps/web/src/lib/server/content/magic-bytes.ts',
        mutator: 'ConditionalExpression',
        line: "if (buf.length >= 12 && buf.slice(4, 8).toString('ascii') === 'ftyp') {",
        replacement: 'true',
        why: "Upstream's AVIF check: below 12 bytes the brand slice is shorter than four characters and never equals 'avif' or 'avis', so the length test decides nothing the brand comparison does not. (The other `true` on this line, for the ftyp test, is killed.)",
      },
      {
        file: 'apps/web/src/lib/server/content/magic-bytes.ts',
        mutator: 'EqualityOperator',
        line: 'if (end > limit) return null',
        replacement: 'end >= limit',
        why: 'A field that ends exactly at its limit leaves no room after it: for the header size that is an empty header, for an id or size inside the header an element with no payload left for a DocType. Both end in null whichever way this comparison falls, so no input separates `>` from `>=` in what the sniffer answers.',
      },
      {
        file: 'apps/web/src/lib/server/content/magic-bytes.ts',
        mutator: 'ConditionalExpression',
        line: 'if (end > limit) return null',
        replacement: 'false',
        why: 'Without this bound a field running past its limit is still refused downstream: past the buffer the bytes read as `undefined`, the value becomes NaN and every following comparison fails; past the header, any payload that follows ends after the header and `payloadEnd > headerEnd` refuses it. Kept because relying on NaN is not something to read; no input distinguishes it.',
      },
      {
        file: 'apps/web/src/lib/server/content/magic-bytes.ts',
        mutator: 'EqualityOperator',
        line: 'while (offset < headerEnd) {',
        replacement: 'offset <= headerEnd',
        why: "One more pass at offset == headerEnd reads a field whose limit is its own start: a length of at least one ends past the limit and returns null, and a zero length returns null, the same answer the loop's exit gives.",
      },
      {
        file: 'apps/web/src/lib/shared/storage-config.ts',
        mutator: 'ConditionalExpression',
        line: 'if (extension === null || !Object.hasOwn(table, extension)) return null',
        replacement: 'false',
        why: "Without the null test, `Object.hasOwn(table, null)` looks up the key 'null', which neither extension table has, so a name without an extension is refused the same way.",
      },
      {
        file: 'apps/web/src/routes/api/portal/upload.ts',
        mutator: 'ConditionalExpression',
        line: 'if (count === null || count <= limit) return null',
        replacement: 'false',
        why: 'A null count is a rate store outage, which fails open. Without the explicit test `null <= limit` is true in JavaScript (null compares as 0), so the outage still lets the upload through: no input separates the two.',
      },
      {
        file: 'apps/web/src/routes/api/portal/upload.ts',
        mutator: 'StringLiteral',
        line: "export const Route = createFileRoute('/api/portal/upload')({",
        replacement: '""',
        why: 'The path argument is read by the route-tree generator from the source text and is kept nowhere on the route object at runtime (measured: the object createFileRoute returns has no path, id or options.path). The handler wiring that is runtime state is asserted.',
      },
      {
        file: 'apps/web/src/lib/server/events/emit.ts',
        mutator: 'ObjectLiteral',
        line: "const log = logger.child({ component: 'emit' })",
        replacement: '{}',
        why: 'The component name is metadata on a log line. It reaches no branch, no return value and no query, and nothing a caller or an operator reads is built from it, so no input can tell the mutant apart.',
      },
      {
        file: 'apps/web/src/lib/server/events/emit.ts',
        mutator: 'StringLiteral',
        line: "const log = logger.child({ component: 'emit' })",
        replacement: '""',
        why: 'The component name is metadata on a log line. It reaches no branch, no return value and no query, and nothing a caller or an operator reads is built from it, so no input can tell the mutant apart.',
      },
      {
        file: 'apps/web/src/lib/server/events/emit.ts',
        mutator: 'ObjectLiteral',
        line: "log.warn({ err: error, type: def.type }, 'best-effort emit failed')",
        replacement: '{}',
        why: "The field set is metadata on a log line. It reaches no branch, no return value and no query: the job's outcome, its row and the error runJob records are the same with or without it, so no input can tell the mutant apart except by asserting the fields back from the logger, which is the tautology the gate exists to expose.",
      },
      {
        file: 'apps/web/src/lib/server/events/emit.ts',
        mutator: 'StringLiteral',
        line: "log.warn({ err: error, type: def.type }, 'best-effort emit failed')",
        replacement: '""',
        why: "The message is metadata on a log line. It reaches no branch, no return value and no query: the job's outcome, its row and the error runJob records are the same with or without it, so no input can tell the mutant apart except by asserting the string back from the logger.",
      },
      {
        file: 'apps/web/src/lib/server/events/event-reactions.ts',
        mutator: 'ObjectLiteral',
        line: "const log = logger.child({ component: 'event-reactions' })",
        replacement: '{}',
        why: 'The component name is metadata on a log line. It reaches no branch, no return value and no query, and nothing a caller or an operator reads is built from it, so no input can tell the mutant apart.',
      },
      {
        file: 'apps/web/src/lib/server/events/event-reactions.ts',
        mutator: 'StringLiteral',
        line: "const log = logger.child({ component: 'event-reactions' })",
        replacement: '""',
        why: 'The component name is metadata on a log line. It reaches no branch, no return value and no query, and nothing a caller or an operator reads is built from it, so no input can tell the mutant apart.',
      },
      {
        file: 'apps/web/src/lib/server/events/event-reactions.ts',
        mutator: 'ConditionalExpression',
        line: "const eventId = typeof job.payload.eventId === 'string' ? job.payload.eventId : null",
        replacement: 'true',
        why: 'Without the type check a non-string eventId reaches the events lookup instead of null. emit() only ever writes a string, and any other JSON value (a number, an object, undefined) matches no events row, so the job takes the same no-op return a line later: no reaction runs and the job succeeds. Only the log line differs (a warning instead of an error), and the cost is one primary-key query that finds nothing.',
      },
      {
        file: 'apps/web/src/lib/server/events/event-reactions.ts',
        mutator: 'ConditionalExpression',
        line: 'if (!eventId) {',
        replacement: 'false',
        why: 'The guard only saves a query. Without it a job with no eventId looks up events where event_id is null, which no row satisfies (the column is NOT NULL), and returns at the next guard: no reaction runs and the job succeeds either way. Only the log line differs.',
      },
      {
        file: 'apps/web/src/lib/server/events/event-reactions.ts',
        mutator: 'BlockStatement',
        line: 'if (!eventId) {',
        replacement: '{}',
        why: 'Same guard, same reason: with the block emptied the lookup by a null eventId matches no row and the job returns at the next guard, so no reaction runs and the job succeeds either way. Only the log line and one query differ.',
      },
      {
        file: 'apps/web/src/lib/server/events/event-reactions.ts',
        mutator: 'ObjectLiteral',
        line: "log.error({ job_id: job.jobId, queue }, 'reaction job payload has no eventId, skipping')",
        replacement: '{}',
        why: "The field set is metadata on a log line. It reaches no branch, no return value and no query: the job's outcome, its row and the error runJob records are the same with or without it, so no input can tell the mutant apart except by asserting the fields back from the logger, which is the tautology the gate exists to expose.",
      },
      {
        file: 'apps/web/src/lib/server/events/event-reactions.ts',
        mutator: 'StringLiteral',
        line: "log.error({ job_id: job.jobId, queue }, 'reaction job payload has no eventId, skipping')",
        replacement: '""',
        why: "The message is metadata on a log line. It reaches no branch, no return value and no query: the job's outcome, its row and the error runJob records are the same with or without it, so no input can tell the mutant apart except by asserting the string back from the logger.",
      },
      {
        file: 'apps/web/src/lib/server/events/event-reactions.ts',
        mutator: 'ObjectLiteral',
        line: "log.warn({ event_id: eventId, queue }, 'reaction job: event row gone, skipping')",
        replacement: '{}',
        why: "The field set is metadata on a log line. It reaches no branch, no return value and no query: the job's outcome, its row and the error runJob records are the same with or without it, so no input can tell the mutant apart except by asserting the fields back from the logger, which is the tautology the gate exists to expose.",
      },
      {
        file: 'apps/web/src/lib/server/events/event-reactions.ts',
        mutator: 'StringLiteral',
        line: "log.warn({ event_id: eventId, queue }, 'reaction job: event row gone, skipping')",
        replacement: '""',
        why: "The message is metadata on a log line. It reaches no branch, no return value and no query: the job's outcome, its row and the error runJob records are the same with or without it, so no input can tell the mutant apart except by asserting the string back from the logger.",
      },
      {
        file: 'apps/web/src/lib/server/events/event-reactions.ts',
        mutator: 'OptionalChaining',
        line: 'timer.unref?.()',
        replacement: 'timer.unref',
        why: 'The optional call guards runtimes whose setTimeout returns a number. Every runtime this runs on (Node and Bun) returns a Timeout object that has unref, so the plain call does exactly what the optional one does.',
      },
      {
        file: 'apps/web/src/lib/server/events/event-reactions.ts',
        mutator: 'ArrowFunction',
        line: 'const results = await Promise.race([settled, deadline]).finally(() => clearTimeout(timer))',
        replacement: '() => undefined',
        why: "Without the clear, the deadline timer of a job that finished in time stays scheduled until the deadline and then resolves a promise nothing awaits any more. The timer is unref'd, so it holds no process open, and the race has already returned: no reaction, job outcome, row or error differs. The difference is a pending timer for at most the deadline, which no test can observe without asserting the clearTimeout call itself.",
      },
      {
        file: 'apps/web/src/lib/server/events/event-reactions.ts',
        mutator: 'ObjectLiteral',
        line: '{',
        replacement: '{}',
        why: "The field set is metadata on a log line. It reaches no branch, no return value and no query: the job's outcome, its row and the error runJob records are the same with or without it, so no input can tell the mutant apart except by asserting the fields back from the logger, which is the tautology the gate exists to expose.",
      },
      {
        file: 'apps/web/src/lib/server/events/event-reactions.ts',
        mutator: 'StringLiteral',
        line: "'event reactions passed their deadline, failing the job'",
        replacement: '""',
        why: "The message is metadata on a log line. It reaches no branch, no return value and no query: the job's outcome, its row and the error runJob records are the same with or without it, so no input can tell the mutant apart except by asserting the string back from the logger.",
      },
      {
        file: 'apps/web/src/lib/server/events/event-reactions.ts',
        mutator: 'BlockStatement',
        line: 'for (const { reaction, err } of failures) {',
        replacement: '{}',
        why: "The loop body only logs each failed reaction. The job still fails with the first failure's error, which runJob records on the row as last_error and which retries the job, so the job's outcome, retry and row are identical without it. Only the per-reaction log lines are lost, which no test can see except through the logger.",
      },
      {
        file: 'apps/web/src/lib/server/events/event-reactions.ts',
        mutator: 'ObjectLiteral',
        line: "log.error({ err, event_type: event.type, event_id: eventId, reaction }, 'event reaction failed')",
        replacement: '{}',
        why: "The field set is metadata on a log line. It reaches no branch, no return value and no query: the job's outcome, its row and the error runJob records are the same with or without it, so no input can tell the mutant apart except by asserting the fields back from the logger, which is the tautology the gate exists to expose.",
      },
      {
        file: 'apps/web/src/lib/server/events/event-reactions.ts',
        mutator: 'StringLiteral',
        line: "log.error({ err, event_type: event.type, event_id: eventId, reaction }, 'event reaction failed')",
        replacement: '""',
        why: "The message is metadata on a log line. It reaches no branch, no return value and no query: the job's outcome, its row and the error runJob records are the same with or without it, so no input can tell the mutant apart except by asserting the string back from the logger.",
      },
      {
        file: 'apps/web/src/lib/server/events/event-reactions-queue.ts',
        mutator: 'ConditionalExpression',
        line: "if (event.type !== 'conversation.csat_submitted') return undefined",
        replacement: 'false',
        why: "The check narrows the event's type for TypeScript. runReactionJob calls this reaction only for the types EVENT_REACTIONS lists for it, which is conversation.csat_submitted alone, so the check is true for every event that reaches it and the mutant runs exactly the same code.",
      },
      {
        file: 'apps/web/src/lib/server/events/event-summaries-queue.ts',
        mutator: 'ConditionalExpression',
        line: "if (event.type !== 'conversation.status_changed' || event.data.newStatus !== 'closed') {",
        replacement: 'false',
        why: 'The type half narrows the event for TypeScript. runReactionJob calls this reaction only for the types EVENT_REACTIONS lists for it, which is conversation.status_changed alone, so that half is false for every event that reaches it; the close half, which does decide, is killed by the non-close status test.',
      },
      {
        file: 'apps/web/src/lib/server/events/event-summaries-queue.ts',
        mutator: 'ConditionalExpression',
        line: "if (event.type !== 'ticket.status_changed' || event.data.newStatus !== 'closed') {",
        replacement: 'false',
        why: 'The type half narrows the event for TypeScript. runReactionJob calls this reaction only for the types EVENT_REACTIONS lists for it, which is ticket.status_changed alone, so that half is false for every event that reaches it; the close half, which does decide, is killed by the non-close status test.',
      },
    ])
  })

  it('still finds the line each record was written for', () => {
    // The record is addressed by the text of its line. When the line is edited
    // the record retires, and the gate reports it as stale on the next run
    // against that file — but that run only happens when someone touches it.
    // This check is on every run, so a record cannot quietly outlive its line.
    for (const record of manifest().equivalents) {
      const source = readFileSync(path.resolve(import.meta.dirname, '../..', record.file), 'utf8')
      const lines = source.split('\n').map((line) => line.trim())
      expect(lines, `${record.file} no longer holds \`${record.line}\``).toContain(record.line)
    }
  })

  it('excuses a mutation only in a file the gate actually grades', () => {
    const graded = manifest().graded.map((entry) => entry.file)
    for (const record of manifest().equivalents) {
      expect(graded, `${record.file} is excused but never mutated`).toContain(record.file)
    }
  })
})
