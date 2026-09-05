/**
 * What has to be true of the stored rules for board→project routing.
 *
 * A rule is one row in `integration_event_mappings`: `targetKey` names the
 * board, `actionConfig.channelId` the project, `filters` the board and the
 * statuses that trigger it. The board is the key, not the project — the unique
 * constraint is on (actionType, eventType, integrationId, targetKey), so a
 * board-keyed row is exactly one rule per board, which is what "a board points
 * at at most one project" means in the schema. Keyed by project instead, two
 * boards pointing at one project would share a row: the second board's trigger
 * statuses would overwrite the first's and the board filter would become their
 * union.
 *
 * Contract (domain language, confirmed before these tests were written; the
 * numbering is the plan's):
 *
 *   V2  A board with no project recorded creates no issue. There is no
 *       catch-all project.
 *   V6  Several boards may point at the same project; a board points at at
 *       most one project. Changing one board's rule never changes another's.
 *
 * The pre-existing GitLab configuration is one filterless row that matches
 * every board and falls back to an instance-wide project. It is the catch-all
 * V2 forbids, and it does not stop being one because per-board rules exist
 * alongside it — it matches first and independently. So enabling routing has
 * to retire it, and that is what `targetKeysToRetire` is for.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  targetKeysToRetire,
  rulesFromMappings,
  boardFilterAllows,
  statusFilterAllows,
  isBoardRoutingRule,
  type StoredMappingWithConfig,
} from '../board-routing-policy'

/** A per-board routing rule as the write path stores it. */
function ruleRow(boardId: string, projectId: string, statusIds: string[]): StoredMappingWithConfig {
  return {
    targetKey: boardId,
    actionConfig: { channelId: projectId },
    filters: { boardIds: [boardId], statusIds },
  }
}

/** The row every instance has today: no filter, no action config, catches all. */
const LEGACY_CATCH_ALL: StoredMappingWithConfig = {
  targetKey: 'default',
  actionConfig: null,
  filters: null,
}

describe('retiring what would still catch everything (V2)', () => {
  it('retires the filterless row that predates routing', () => {
    expect(targetKeysToRetire([LEGACY_CATCH_ALL])).toEqual(['default'])
  })

  it('retires it even when per-board rules already exist beside it', () => {
    const stored = [ruleRow('board-asbs', '222', ['status-triaged']), LEGACY_CATCH_ALL]

    expect(targetKeysToRetire(stored)).toEqual(['default'])
  })

  it('keeps every per-board rule', () => {
    const stored = [
      ruleRow('board-asbs', '222', ['status-triaged']),
      ruleRow('board-gwg', '333', ['status-triaged']),
    ]

    expect(targetKeysToRetire(stored)).toEqual([])
  })

  it('retires a row that names boards but no triggering status', () => {
    // Not a routing rule: it fires on every status, which is the behaviour
    // "an issue is created after triage" exists to replace. Left in place it
    // would open an issue on the post's very first status change.
    const boardsOnly: StoredMappingWithConfig = {
      targetKey: 'board-asbs',
      actionConfig: { channelId: '222' },
      filters: { boardIds: ['board-asbs'] },
    }

    expect(targetKeysToRetire([boardsOnly])).toEqual(['board-asbs'])
  })

  it('names each key once, however many rows carry it', () => {
    expect(targetKeysToRetire([LEGACY_CATCH_ALL, LEGACY_CATCH_ALL])).toEqual(['default'])
  })

  it('has nothing to retire when there is nothing stored', () => {
    expect(targetKeysToRetire([])).toEqual([])
  })
})

describe('reading the stored rules back (V6)', () => {
  it('reads one rule per board', () => {
    const stored = [
      ruleRow('board-datenschutz', '111', ['status-triaged']),
      ruleRow('board-asbs', '222', ['status-triaged', 'status-planned']),
    ]

    expect(rulesFromMappings(stored)).toEqual([
      { boardId: 'board-datenschutz', projectId: '111', triggerStatusIds: ['status-triaged'] },
      {
        boardId: 'board-asbs',
        projectId: '222',
        triggerStatusIds: ['status-triaged', 'status-planned'],
      },
    ])
  })

  it('lets two boards name the same project', () => {
    const stored = [
      ruleRow('board-asbs', '777', ['status-triaged']),
      ruleRow('board-gwg', '777', ['status-triaged']),
    ]

    expect(rulesFromMappings(stored).map((r) => r.projectId)).toEqual(['777', '777'])
  })

  it('does not read the legacy row back as a rule', () => {
    expect(rulesFromMappings([LEGACY_CATCH_ALL])).toEqual([])
  })

  it('does not read a row back as a rule when it names no project', () => {
    const noProject: StoredMappingWithConfig = {
      targetKey: 'board-asbs',
      actionConfig: {},
      filters: { boardIds: ['board-asbs'], statusIds: ['status-triaged'] },
    }

    expect(rulesFromMappings([noProject])).toEqual([])
  })

  it('does not read a row back as a rule when its key and its board filter disagree', () => {
    // Nothing the write path produces looks like this. If it turns up, the row
    // is not a rule for either board, and guessing which is exactly the kind of
    // thing that would route one product's feedback into another's tracker.
    const inconsistent: StoredMappingWithConfig = {
      targetKey: 'board-asbs',
      actionConfig: { channelId: '222' },
      filters: { boardIds: ['board-gwg'], statusIds: ['status-triaged'] },
    }

    expect(rulesFromMappings([inconsistent])).toEqual([])
  })
})

describe('properties', () => {
  const boardId = fc.constantFrom('board-a', 'board-b', 'board-c')
  const projectId = fc.constantFrom('111', '222')
  const statusId = fc.constantFrom('status-new', 'status-triaged')
  const anyRuleRow = fc
    .tuple(boardId, projectId, fc.uniqueArray(statusId, { minLength: 1, maxLength: 2 }))
    .map(([b, p, s]) => ruleRow(b, p, s))
  const anyRow = fc.oneof(anyRuleRow, fc.constant(LEGACY_CATCH_ALL))

  it('retires exactly the rows it does not read back as rules (V2)', () => {
    fc.assert(
      fc.property(fc.array(anyRow, { maxLength: 6 }), (stored) => {
        const retired = new Set(targetKeysToRetire(stored))
        const kept = new Set(rulesFromMappings(stored).map((r) => r.boardId))

        // Unguarded and in both directions: a row is either a rule we keep or a
        // key we retire, never neither. "Neither" is how a catch-all survives a
        // migration that looked like it ran.
        for (const row of stored) {
          expect(retired.has(row.targetKey) || kept.has(row.targetKey), row.targetKey).toBe(true)
        }
        for (const key of retired) {
          expect(kept.has(key), `${key} is both retired and read back`).toBe(false)
        }
      })
    )
  })

  it("editing one board's row never changes what another board's row reads as (V6)", () => {
    fc.assert(
      fc.property(fc.array(anyRuleRow, { maxLength: 4 }), anyRuleRow, (rows, edited) => {
        // `edited` is a stored row, so its board is `targetKey`. Reading a
        // `boardId` off it — the name it has once it has been read back as a
        // rule — silently yields undefined and makes the filter keep
        // everything, which is how the first version of this property failed
        // against correct code.
        const others = rows.filter((r) => r.targetKey !== edited.targetKey)
        const before = rulesFromMappings(others)
        const after = rulesFromMappings([...others, edited]).filter(
          (r) => r.boardId !== edited.targetKey
        )

        expect(after).toEqual(before)
      })
    )
  })

  it('never invents a project that no stored row named (V6)', () => {
    fc.assert(
      fc.property(fc.array(anyRow, { maxLength: 6 }), (stored) => {
        const stored_projects = new Set(
          stored.map((row) => row.actionConfig?.channelId).filter((id): id is string => !!id)
        )

        for (const rule of rulesFromMappings(stored)) {
          expect(stored_projects.has(rule.projectId), rule.projectId).toBe(true)
        }
      })
    )
  })
})

describe('a row is retired unless it is a complete rule', () => {
  it('retires a filterless row whatever project it names', () => {
    const withProject: StoredMappingWithConfig = {
      targetKey: 'default',
      actionConfig: { channelId: '999' },
      filters: null,
    }

    expect(targetKeysToRetire([withProject])).toEqual(['default'])
  })

  it('retires a row that names boards and statuses but no project', () => {
    // This one is not merely useless, it is the catch-all in disguise: with no
    // `actionConfig.channelId` the resolver falls back to the instance-wide
    // project, so the row routes this board's posts into whatever project the
    // integration was pointed at before. Leaving it is V2 broken with extra
    // steps.
    const noProject: StoredMappingWithConfig = {
      targetKey: 'board-asbs',
      actionConfig: {},
      filters: { boardIds: ['board-asbs'], statusIds: ['status-triaged'] },
    }

    expect(targetKeysToRetire([noProject])).toEqual(['board-asbs'])
  })

  it('retires a row whose project is not a string, which jsonb allows', () => {
    // action_config is jsonb. Nothing this code writes puts a number there,
    // and a row that has one is not a rule we can act on — routing to project
    // 222 and to project "222" are not obviously the same thing to GitLab, and
    // guessing is how a product's feedback lands in another product's tracker.
    const numericProject: StoredMappingWithConfig = {
      targetKey: 'board-asbs',
      actionConfig: { channelId: 222 },
      filters: { boardIds: ['board-asbs'], statusIds: ['status-triaged'] },
    }

    expect(targetKeysToRetire([numericProject])).toEqual(['board-asbs'])
    expect(rulesFromMappings([numericProject])).toEqual([])
  })

  it('retires a row whose key and board filter disagree', () => {
    const inconsistent: StoredMappingWithConfig = {
      targetKey: 'board-asbs',
      actionConfig: { channelId: '222' },
      filters: { boardIds: ['board-gwg'], statusIds: ['status-triaged'] },
    }

    expect(targetKeysToRetire([inconsistent])).toEqual(['board-asbs'])
  })
})

/**
 * The two filters the event resolver applies, tested directly.
 *
 * They are reached through `buildIntegrationTargets` in
 * `events/__tests__/board-issue-routing.test.ts`, which is where the routing
 * guarantees are stated. Here they are pinned on their own, including the
 * shapes the resolver never produces but jsonb permits.
 */
describe('the board filter (V1, V2)', () => {
  it('lets everything through when the mapping names no boards', () => {
    expect(boardFilterAllows(null, ['board-a'])).toBe(true)
    expect(boardFilterAllows({}, ['board-a'])).toBe(true)
    expect(boardFilterAllows({ boardIds: [] }, ['board-a'])).toBe(true)
  })

  it('lets an event through when it names one of the filtered boards', () => {
    expect(boardFilterAllows({ boardIds: ['board-a', 'board-b'] }, ['board-b'])).toBe(true)
  })

  it('stops an event on a board the mapping does not name', () => {
    expect(boardFilterAllows({ boardIds: ['board-a'] }, ['board-c'])).toBe(false)
  })

  it('lets a board-less event reach a chat mapping filtered to a board', () => {
    // Conversation and ticket events carry no board, and a channel filtered to
    // a board should keep receiving them.
    expect(boardFilterAllows({ boardIds: ['board-a'] }, [])).toBe(true)
  })

  it('stops a board-less event at a routing rule (V1)', () => {
    // The exception above inverted: "no board" would mean "every project", so
    // one post would open an issue in every product's tracker.
    expect(boardFilterAllows({ boardIds: ['board-a'], statusIds: ['status-x'] }, [])).toBe(false)
  })

  it('stops a routing rule on a board it does not name, board-less or not', () => {
    const rule = { boardIds: ['board-a'], statusIds: ['status-x'] }

    expect(boardFilterAllows(rule, ['board-c'])).toBe(false)
    expect(boardFilterAllows(rule, ['board-a'])).toBe(true)
  })
})

describe('the status filter (V4, V7)', () => {
  it('lets everything through when the mapping names no statuses', () => {
    expect(statusFilterAllows(null, 'status-x')).toBe(true)
    expect(statusFilterAllows({ boardIds: ['board-a'] }, 'status-x')).toBe(true)
    expect(statusFilterAllows({ statusIds: [] }, 'status-x')).toBe(true)
  })

  it('lets a post through in one of the named statuses', () => {
    expect(statusFilterAllows({ statusIds: ['status-x', 'status-y'] }, 'status-y')).toBe(true)
  })

  it('stops a post in a status the rule does not name', () => {
    expect(statusFilterAllows({ statusIds: ['status-x'] }, 'status-z')).toBe(false)
  })

  it('stops a post whose status is unknown, rather than treating that as any', () => {
    expect(statusFilterAllows({ statusIds: ['status-x'] }, undefined)).toBe(false)
    expect(statusFilterAllows({ statusIds: ['status-x'] }, '')).toBe(false)
  })

  it('does not match an unknown status against a rule that names an empty one', () => {
    // Nothing writes an empty status id — the input schema rejects it — but
    // jsonb holds whatever is in it. "Unknown" and "named as empty" meeting and
    // counting as a match is the one way this filter could let a post through
    // that no rule actually selected.
    expect(statusFilterAllows({ statusIds: [''] }, '')).toBe(false)
    expect(statusFilterAllows({ statusIds: [''] }, undefined)).toBe(false)
  })
})

describe('recognising a routing rule', () => {
  it('is a rule exactly when it names at least one status', () => {
    expect(isBoardRoutingRule({ statusIds: ['status-x'] })).toBe(true)
    expect(isBoardRoutingRule({ statusIds: [] })).toBe(false)
    expect(isBoardRoutingRule({ boardIds: ['board-a'] })).toBe(false)
    expect(isBoardRoutingRule(null)).toBe(false)
  })
})

describe('shapes jsonb permits that the write path never produces', () => {
  it('is not a rule when it names no board at all', () => {
    const noBoard: StoredMappingWithConfig = {
      targetKey: 'board-asbs',
      actionConfig: { channelId: '222' },
      filters: { statusIds: ['status-triaged'] },
    }

    expect(targetKeysToRetire([noBoard])).toEqual(['board-asbs'])
    expect(rulesFromMappings([noBoard])).toEqual([])
  })

  it('is not a rule when it names two boards', () => {
    // One row, one board — that is what makes the row's key meaningful. A row
    // filtered to two boards has no single board it belongs to.
    const twoBoards: StoredMappingWithConfig = {
      targetKey: 'board-asbs',
      actionConfig: { channelId: '222' },
      filters: { boardIds: ['board-asbs', 'board-gwg'], statusIds: ['status-triaged'] },
    }

    expect(targetKeysToRetire([twoBoards])).toEqual(['board-asbs'])
    expect(rulesFromMappings([twoBoards])).toEqual([])
  })

  it('is not a rule when its project is an empty string', () => {
    const blank: StoredMappingWithConfig = {
      targetKey: 'board-asbs',
      actionConfig: { channelId: '' },
      filters: { boardIds: ['board-asbs'], statusIds: ['status-triaged'] },
    }

    expect(targetKeysToRetire([blank])).toEqual(['board-asbs'])
    expect(rulesFromMappings([blank])).toEqual([])
  })

  it('is not a rule when it has no action config at all', () => {
    const noConfig: StoredMappingWithConfig = {
      targetKey: 'board-asbs',
      actionConfig: null,
      filters: { boardIds: ['board-asbs'], statusIds: ['status-triaged'] },
    }

    expect(targetKeysToRetire([noConfig])).toEqual(['board-asbs'])
    expect(rulesFromMappings([noConfig])).toEqual([])
  })
})
