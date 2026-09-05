/**
 * Which linked issue a board change may move, and where to.
 *
 * A board is a product, and each product has its own GitLab project. Moving a
 * post between boards therefore has to move its issue between projects, or the
 * feedback and the work on it drift apart. This module is the decision alone —
 * no database, no HTTP — so the guarantees below can be checked directly.
 *
 * Contract (domain language, confirmed before these tests were written):
 *
 *   V11 A post that moves to a board with a different project takes its issue
 *       with it, and the link afterwards points at the issue in the new
 *       project.
 *   V12 A post that moves to a board with the same project leaves the issue
 *       untouched.
 *   V13 A post that had exactly one active GitLab link before the move has
 *       exactly one after it — never none, never two. That holds when the move
 *       fails as well.
 *   V14 A post that moves to a board with no project leaves the issue where it
 *       is, and the link stays valid.
 *   V15 A board change causes at most one move; a redelivered report of the
 *       same change does not move a second time.
 *   V16 Someone who may not move a post to another board triggers no move in
 *       GitLab either.
 *
 * This file covers V11, V12, V14 and V15's key. V13 is a conservation law over
 * the write, so it lives with the handler in
 * `integrations/gitlab/server/__tests__/issue-move.test.ts`. V16 is a property
 * of the caller — `changeBoard` emits nothing when it refuses — and is checked
 * in `domains/posts/__tests__/post-board-event.db.test.ts`.
 *
 * The contract was agreed in German and is written here in English, which is
 * the language of this repository.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { buildIssueMoveTargets, type MoveCandidateLink } from '../issue-move-policy'

/** An active GitLab link, reduced to what the decision reads. */
function gitlabLink(overrides: Partial<MoveCandidateLink> = {}): MoveCandidateLink {
  return {
    linkId: 'pxl_one',
    integrationId: 'int_gitlab',
    integrationType: 'gitlab',
    externalId: '42',
    externalScope: '101',
    ...overrides,
  }
}

describe('buildIssueMoveTargets', () => {
  it('moves the issue when the new board has a different project (V11)', () => {
    const targets = buildIssueMoveTargets({ links: [gitlabLink()], toProjectId: '202' })

    expect(targets).toHaveLength(1)
    expect(targets[0].type).toBe('gitlab_issue_move')
    expect(targets[0].target).toEqual({
      linkId: 'pxl_one',
      externalId: '42',
      fromProjectId: '101',
      toProjectId: '202',
    })
    expect(targets[0].config).toEqual({ integrationId: 'int_gitlab' })
  })

  it('leaves the issue alone when the new board has the same project (V12)', () => {
    const targets = buildIssueMoveTargets({
      links: [gitlabLink({ externalScope: '202' })],
      toProjectId: '202',
    })

    expect(targets).toEqual([])
  })

  it('leaves the issue alone when the new board has no project (V14)', () => {
    const targets = buildIssueMoveTargets({ links: [gitlabLink()], toProjectId: null })

    expect(targets).toEqual([])
  })

  it('leaves a link alone whose project we do not know (V14)', () => {
    // A link made before per-project identity landed carries no scope. Moving
    // needs the source project, and guessing it from the URL is exactly what
    // the scoped-link change stopped doing.
    const targets = buildIssueMoveTargets({
      links: [gitlabLink({ externalScope: null })],
      toProjectId: '202',
    })

    expect(targets).toEqual([])
  })

  it('leaves a link of another tracker alone', () => {
    const targets = buildIssueMoveTargets({
      links: [gitlabLink({ integrationType: 'linear', externalScope: '101' })],
      toProjectId: '202',
    })

    expect(targets).toEqual([])
  })

  it('leaves a link with no integration alone', () => {
    // A sidebar link carries no integration record, so there is no token to
    // move it with.
    const targets = buildIssueMoveTargets({
      links: [gitlabLink({ integrationId: null })],
      toProjectId: '202',
    })

    expect(targets).toEqual([])
  })

  it('keys the delivery per link so one change moves an issue once (V15)', () => {
    const targets = buildIssueMoveTargets({ links: [gitlabLink()], toProjectId: '202' })

    expect(targets[0].deliveryKey).toBe('gitlab-issue-move:pxl_one')
  })

  it('gives two links of the same post two distinct delivery keys (V15)', () => {
    const targets = buildIssueMoveTargets({
      links: [gitlabLink(), gitlabLink({ linkId: 'pxl_two', externalId: '43' })],
      toProjectId: '202',
    })

    const keys = targets.map((t) => t.deliveryKey)
    expect(new Set(keys).size).toBe(targets.length)
  })

  it('moves every eligible link of a post, not just the first (V11)', () => {
    const targets = buildIssueMoveTargets({
      links: [
        gitlabLink(),
        gitlabLink({ linkId: 'pxl_two', externalId: '43', externalScope: '202' }),
        gitlabLink({ linkId: 'pxl_three', externalId: '44', externalScope: '303' }),
      ],
      toProjectId: '202',
    })

    expect(targets.map((t) => t.deliveryKey)).toEqual([
      'gitlab-issue-move:pxl_one',
      'gitlab-issue-move:pxl_three',
    ])
  })

  it('produces nothing for a post with no links at all', () => {
    expect(buildIssueMoveTargets({ links: [], toProjectId: '202' })).toEqual([])
  })
})

describe('buildIssueMoveTargets — properties', () => {
  const linkArb = fc.record({
    linkId: fc.string({ minLength: 1, maxLength: 8 }),
    integrationId: fc.option(fc.constant('int_gitlab'), { nil: null }),
    integrationType: fc.constantFrom('gitlab', 'linear', 'jira', 'github'),
    externalId: fc.string({ minLength: 1, maxLength: 4 }),
    externalScope: fc.option(fc.constantFrom('101', '202', '303'), { nil: null }),
  })

  it('never targets the project the issue is already in (V12)', () => {
    fc.assert(
      fc.property(
        fc.array(linkArb, { maxLength: 6 }),
        fc.constantFrom('101', '202', '303'),
        (links, toProjectId) => {
          const targets = buildIssueMoveTargets({ links, toProjectId })
          for (const t of targets) {
            const { fromProjectId, toProjectId: to } = t.target as {
              fromProjectId: string
              toProjectId: string
            }
            expect(fromProjectId).not.toBe(to)
          }
        }
      )
    )
  })

  it('never produces a target when the new board has no project (V14)', () => {
    fc.assert(
      fc.property(fc.array(linkArb, { maxLength: 6 }), (links) => {
        expect(buildIssueMoveTargets({ links, toProjectId: null })).toEqual([])
      })
    )
  })

  it('produces at most one target per link (V15)', () => {
    fc.assert(
      fc.property(
        fc.array(linkArb, { maxLength: 6 }),
        fc.constantFrom('101', '202'),
        (links, toProjectId) => {
          const targets = buildIssueMoveTargets({ links, toProjectId })
          expect(targets.length).toBeLessThanOrEqual(links.length)
          expect(new Set(targets.map((t) => t.deliveryKey)).size).toBe(targets.length)
        }
      )
    )
  })

  it('adding a link that cannot move never changes what the others do', () => {
    // Non-interference: the decision is per link, so an ineligible neighbour —
    // wrong tracker, no integration, unknown project — must not add, remove or
    // alter a single target.
    const ineligible = fc.oneof(
      linkArb.map((l) => ({ ...l, integrationType: 'linear' })),
      linkArb.map((l) => ({ ...l, integrationId: null })),
      linkArb.map((l) => ({ ...l, externalScope: null }))
    )

    fc.assert(
      fc.property(
        fc.array(linkArb, { maxLength: 4 }),
        ineligible,
        fc.constantFrom('101', '202'),
        (links, extra, toProjectId) => {
          const before = buildIssueMoveTargets({ links, toProjectId })
          const after = buildIssueMoveTargets({ links: [...links, extra], toProjectId })
          expect(after).toEqual(before)
        }
      )
    )
  })
})
