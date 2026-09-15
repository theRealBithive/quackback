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
