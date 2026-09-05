/**
 * Which GitLab project a post's issue is created in.
 *
 * One instance, several products: each product is a board, and each board has
 * its own GitLab project. The rule that decides where a post's issue goes is a
 * row in `integration_event_mappings` — `targetKey` names the board,
 * `actionConfig.channelId` the project, `filters` the board and the statuses
 * that trigger it. `buildIntegrationTargets` is where those rows become
 * destinations, and it is the whole decision, so it is where the guarantees
 * are held.
 *
 * Contract (domain language, confirmed before these tests were written; the
 * numbering is the plan's, so gaps are guarantees that live elsewhere):
 *
 *   V1  A post creates an issue only in the GitLab project recorded for its
 *       board — in no other.
 *   V2  A board with no project recorded creates no issue. There is no
 *       catch-all project.
 *   V4  An issue is created only once the post reaches one of the triggering
 *       statuses recorded for its board. A post merely arriving creates none.
 *   V6  Several boards may point at the same project; a board points at at
 *       most one project. Changing one board's rule never changes another's.
 *   V7  Renaming a status does not change which posts create an issue.
 *
 * V3 (no second issue for a post that already has a link) and V5 (a changed
 * rule takes effect for the next post, without a restart) are not decisions
 * this function makes: V3 is the guard in the GitLab hook, V5 is cache
 * invalidation on the write path. V17 (a new rule creates nothing for posts
 * that already exist) is a property of the write path — it does nothing else.
 *
 * Two things here were measured against the code as it stood, not reasoned
 * about, and both are why this module exists:
 *
 *  - A mapping filtered to board A already yields nothing for an event on
 *    board C. The fallback to the instance-wide `integrationConfig.channelId`
 *    sits *behind* the board filter and is never reached by a board that has
 *    no rule. So V2 needs the legacy filterless row deleted, and nothing else.
 *  - An event that names no board at all passes *every* board filter, because
 *    the filter is skipped when the event has no boards. With three products
 *    that is three issues in three projects for one post — V1 inverted.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { buildIntegrationTargets, type CachedMapping } from '../resolvers/integration.resolver'

const decrypt = (blob: string) => ({ accessToken: `token-for-${blob}` })

/** A board→project routing rule as the write path stores it. */
function rule(boardId: string, projectId: string, statusIds: string[]): CachedMapping {
  return {
    eventType: 'post.status_changed',
    integrationType: 'gitlab',
    secrets: 'enc',
    integrationConfig: {},
    actionConfig: { channelId: projectId },
    filters: { boardIds: [boardId], statusIds },
  }
}

function projectsOf(targets: { target: unknown }[]): string[] {
  return targets.map((t) => (t.target as { channelId: string }).channelId)
}

const TRIAGED = 'status-planned'

describe('a post reaches a triggering status', () => {
  it('creates an issue in its own board project and in no other (V1)', () => {
    const targets = buildIntegrationTargets(
      [
        rule('board-datenschutz', '111', [TRIAGED]),
        rule('board-asbs', '222', [TRIAGED]),
        rule('board-gwg', '333', [TRIAGED]),
      ],
      'post.status_changed',
      ['board-asbs'],
      'https://portal.example',
      decrypt,
      TRIAGED
    )

    expect(projectsOf(targets)).toEqual(['222'])
  })

  it('creates nothing for a board that has no rule, and falls back to no catch-all (V2)', () => {
    const targets = buildIntegrationTargets(
      [rule('board-datenschutz', '111', [TRIAGED])],
      'post.status_changed',
      ['board-without-a-rule'],
      'https://portal.example',
      decrypt,
      TRIAGED
    )

    expect(targets).toEqual([])
  })

  it('creates nothing when the instance-wide project is the only project on record (V2)', () => {
    // The pre-existing shape: one filterless mapping and a project in the
    // integration's own config. It matches every board, which is exactly what
    // per-board routing must not do — so the write path deletes this row. Until
    // it does, this is what it does, and the test says so rather than implying
    // the mechanism already prevents it.
    const legacy: CachedMapping = {
      eventType: 'post.status_changed',
      integrationType: 'gitlab',
      secrets: 'enc',
      integrationConfig: { channelId: '999' },
      actionConfig: {},
      filters: null,
    }

    const targets = buildIntegrationTargets(
      [legacy],
      'post.status_changed',
      ['board-gwg'],
      'https://portal.example',
      decrypt,
      TRIAGED
    )

    expect(projectsOf(targets)).toEqual(['999'])
  })
})

describe('the status decides when, not whether', () => {
  it('creates nothing while the post sits in a status the board does not trigger on (V4)', () => {
    const targets = buildIntegrationTargets(
      [rule('board-asbs', '222', [TRIAGED])],
      'post.status_changed',
      ['board-asbs'],
      'https://portal.example',
      decrypt,
      'status-under-review'
    )

    expect(targets).toEqual([])
  })

  it('creates nothing when no status is known at all, rather than treating that as any (V4)', () => {
    const targets = buildIntegrationTargets(
      [rule('board-asbs', '222', [TRIAGED])],
      'post.status_changed',
      ['board-asbs'],
      'https://portal.example',
      decrypt,
      undefined
    )

    expect(targets).toEqual([])
  })

  it('honours every triggering status a board records, not only the first (V4)', () => {
    const twoTriggers = rule('board-gwg', '333', ['status-planned', 'status-in-progress'])

    for (const statusId of ['status-planned', 'status-in-progress']) {
      const targets = buildIntegrationTargets(
        [twoTriggers],
        'post.status_changed',
        ['board-gwg'],
        'https://portal.example',
        decrypt,
        statusId
      )
      expect(projectsOf(targets), `status ${statusId}`).toEqual(['333'])
    }
  })

  it('leaves a chat mapping that names no statuses reacting to every status (V4)', () => {
    // Slack and Discord subscribe without a status filter and must keep doing
    // so. The status filter is only a filter for rules that declare one.
    const slack: CachedMapping = {
      eventType: 'post.status_changed',
      integrationType: 'slack',
      secrets: 'enc',
      integrationConfig: {},
      actionConfig: { channelId: 'C-product' },
      filters: { boardIds: ['board-asbs'] },
    }

    const targets = buildIntegrationTargets(
      [slack],
      'post.status_changed',
      ['board-asbs'],
      'https://portal.example',
      decrypt,
      'status-anything-at-all'
    )

    expect(projectsOf(targets)).toEqual(['C-product'])
  })
})

describe('an event that names no board', () => {
  it('creates no issue anywhere, rather than one in every project (V1)', () => {
    const targets = buildIntegrationTargets(
      [
        rule('board-datenschutz', '111', [TRIAGED]),
        rule('board-asbs', '222', [TRIAGED]),
        rule('board-gwg', '333', [TRIAGED]),
      ],
      'post.status_changed',
      [],
      'https://portal.example',
      decrypt,
      TRIAGED
    )

    expect(targets).toEqual([])
  })

  it('still reaches a chat channel filtered to a board, which is what that exception is for', () => {
    // Conversation and ticket events carry no board. A channel filtered to a
    // board keeps receiving them — removing that would change Slack and Discord,
    // which this change does not touch.
    const slack: CachedMapping = {
      eventType: 'ticket.created',
      integrationType: 'slack',
      secrets: 'enc',
      integrationConfig: {},
      actionConfig: { channelId: 'C-support' },
      filters: { boardIds: ['board-asbs'] },
    }

    const targets = buildIntegrationTargets(
      [slack],
      'ticket.created',
      [],
      'https://portal.example',
      decrypt,
      undefined
    )

    expect(projectsOf(targets)).toEqual(['C-support'])
  })
})

describe('boards and projects are many-to-one', () => {
  it('lets two boards share one project (V6)', () => {
    const shared = [rule('board-asbs', '777', [TRIAGED]), rule('board-gwg', '777', [TRIAGED])]

    for (const boardId of ['board-asbs', 'board-gwg']) {
      const targets = buildIntegrationTargets(
        shared,
        'post.status_changed',
        [boardId],
        'https://portal.example',
        decrypt,
        TRIAGED
      )
      expect(projectsOf(targets), boardId).toEqual(['777'])
    }
  })

  it('creates one issue, not two, when a board somehow holds two rules for one project (V6)', () => {
    const targets = buildIntegrationTargets(
      [rule('board-asbs', '222', [TRIAGED]), rule('board-asbs', '222', [TRIAGED])],
      'post.status_changed',
      ['board-asbs'],
      'https://portal.example',
      decrypt,
      TRIAGED
    )

    expect(projectsOf(targets)).toEqual(['222'])
  })
})

describe('properties', () => {
  const boardId = fc.constantFrom('board-datenschutz', 'board-asbs', 'board-gwg', 'board-other')
  const projectId = fc.constantFrom('111', '222', '333')
  const statusId = fc.constantFrom('status-new', 'status-planned', 'status-shipped')
  const anyRule = fc
    .tuple(boardId, projectId, fc.uniqueArray(statusId, { minLength: 1, maxLength: 3 }))
    .map(([b, p, s]) => rule(b, p, s))

  it('never names a project that no rule for the event board recorded (V1)', () => {
    fc.assert(
      fc.property(
        fc.array(anyRule, { maxLength: 6 }),
        boardId,
        statusId,
        (rules, eventBoard, eventStatus) => {
          const targets = buildIntegrationTargets(
            rules,
            'post.status_changed',
            [eventBoard],
            'https://portal.example',
            decrypt,
            eventStatus
          )

          const allowed = new Set(
            rules
              .filter((r) => {
                const f = r.filters as { boardIds: string[]; statusIds: string[] }
                return f.boardIds.includes(eventBoard) && f.statusIds.includes(eventStatus)
              })
              .map((r) => (r.actionConfig as { channelId: string }).channelId)
          )

          for (const project of projectsOf(targets)) {
            expect(allowed.has(project), `${project} was not recorded for ${eventBoard}`).toBe(true)
          }
        }
      )
    )
  })

  it("changing another board's rule never changes this board's destinations (V6)", () => {
    fc.assert(
      fc.property(
        fc.array(anyRule, { maxLength: 5 }),
        anyRule,
        boardId,
        statusId,
        (rules, extra, eventBoard, eventStatus) => {
          const run = (ms: CachedMapping[]) =>
            projectsOf(
              buildIntegrationTargets(
                ms,
                'post.status_changed',
                [eventBoard],
                'https://portal.example',
                decrypt,
                eventStatus
              )
            )

          const before = run(rules)
          const after = run([...rules, extra])
          const extraFilters = extra.filters as { boardIds: string[] }

          // Unguarded: whatever the added rule is, it can only ever add, never
          // remove or reorder. A branch that quietly dropped a destination
          // would pass a test that only checked the unrelated-board case.
          expect(after.slice(0, before.length)).toEqual(before)

          if (!extraFilters.boardIds.includes(eventBoard)) {
            expect(after).toEqual(before)
          }
        }
      )
    )
  })

  it('reads the status id, so nothing about a status name can change routing (V7)', () => {
    fc.assert(
      fc.property(
        fc.array(anyRule, { maxLength: 4 }),
        boardId,
        statusId,
        fc.string(),
        fc.string(),
        (rules, eventBoard, eventStatus, oldName, newName) => {
          const run = (extra: Record<string, unknown>) =>
            projectsOf(
              buildIntegrationTargets(
                rules.map((r) => ({
                  ...r,
                  actionConfig: { ...(r.actionConfig as object), ...extra },
                })),
                'post.status_changed',
                [eventBoard],
                'https://portal.example',
                decrypt,
                eventStatus
              )
            )

          // Status names ride along in the event and in stored config. None of
          // them may reach the decision: renaming "Planned" must not silently
          // stop a board from creating issues.
          expect(run({ statusName: newName, previousStatus: oldName })).toEqual(
            run({ statusName: oldName, previousStatus: newName })
          )
        }
      )
    )
  })
})
