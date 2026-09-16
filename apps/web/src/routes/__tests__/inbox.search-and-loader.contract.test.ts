/**
 * The inbox route's URL contract: one normalizer, read by the page and by the
 * loader alike, and a loader that no longer re-runs when the selection moves.
 *
 * Upstream's `inbox.route-shape.test.ts` beside this one pins the two facts
 * the refactor turns on (no `loaderDeps`, `?c=` normalized). This suite states
 * the laws: that no facet the normalizer rejects can reach a query, and that
 * the loader — which is no longer handed the validated search — really does
 * read the same normalized values the component does.
 *
 * Contract for the batch E pick (upstream #553, `f8062929a`) — the confirmed
 * list; the whole of it is in
 * `lib/client/conversation/__tests__/reconcile-cached-thread.contract.test.ts`:
 *
 *   E1 Switching conversations never takes the surrounding page down to a
 *      spinner. The list and the thread arrive on their own.
 *   E8 A change to a conversation's priority or SLA deadline reorders the
 *      queues that sort by them.
 *   E9 The inbox reads its URL through one normalizer, and the loader sees
 *      the same normalized values the page does. A search term given as a
 *      number is still a search term; an id that is not a valid id of its
 *      kind is ignored rather than forwarded; a facet the normalizer rejected
 *      never reaches a query.
 */
import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'
import { generateId } from '@quackback/ids'
import { agentEventChangesInboxList } from '@/components/conversation/events-reducer'
import type { ConversationDTO, ConversationStreamEvent } from '@/lib/shared/conversation/types'
import { Route } from '../admin/inbox'

type Search = Record<string, unknown>

interface RouteOptions {
  loaderDeps?: unknown
  loader: (args: { context: unknown; location: { search: Search } }) => Promise<unknown>
  validateSearch: (search: Search) => Record<string, unknown>
}

const options = (Route as unknown as { options: RouteOptions }).options
const normalize = options.validateSearch

/** The id-shaped facets, with the kind each one only accepts. */
const ID_FACETS = [
  ['m', 'conversation_msg'],
  ['tag', 'conversation_tag'],
  ['segment', 'segment'],
  ['team', 'team'],
  ['viewId', 'conversation_view'],
  ['post', 'post'],
  ['company', 'company'],
  ['ttype', 'ticket_type'],
] as const

/** The facets that accept a fixed vocabulary rather than an id. */
const VOCABULARY_FACETS = ['view', 'sort', 'status', 'priority', 'ai', 'channel'] as const

/**
 * Values that are not a valid anything: not an id of any kind, not a member of
 * any facet vocabulary. Restricting the generator this way is the contract —
 * "a facet the normalizer rejected" is only about rejected values — and not a
 * reaction to a counterexample.
 */
const junk = fc.oneof(
  fc.string({ minLength: 1 }).map((s) => `not-an-id-${s}`),
  fc.constantFrom('', '   ', '../../etc/passwd', "'; drop table conversation; --", '%00'),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.constant({ nested: 'object' })
)

describe('the inbox URL normalizer (E9)', () => {
  it('drops a junk facet as completely as an absent one', () => {
    const absent = normalize({})
    fc.assert(
      fc.property(
        fc.constantFrom(...ID_FACETS.map(([field]) => field), ...VOCABULARY_FACETS, 'i', 'c'),
        junk,
        (field, value) => {
          expect(normalize({ [field]: value })).toEqual(absent)
        }
      ),
      { numRuns: 300 }
    )
  })

  it('keeps an id that really is an id of that facet’s kind', () => {
    for (const [field, kind] of ID_FACETS) {
      const id = generateId(kind)
      expect(normalize({ [field]: id })[field]).toBe(id)
      // …and refuses the same id under a different facet, so the kind is what
      // is checked rather than the shape.
      const otherField = ID_FACETS.find(([name]) => name !== field)![0]
      expect(normalize({ [otherField]: id })[otherField]).toBeUndefined()
    }
  })

  it('reads a search term given as a number as a search term', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        expect(normalize({ q: n }).q).toBe(String(n))
      })
    )
    expect(normalize({ q: 'refund' }).q).toBe('refund')
    expect(normalize({ q: '' }).q).toBeUndefined()
  })

  it('accepts the legacy ?c= alias for either kind of open item', () => {
    for (const kind of ['conversation', 'ticket'] as const) {
      const id = generateId(kind)
      expect(normalize({ c: id }).i).toBe(id)
      expect(normalize({ i: id }).i).toBe(id)
    }
  })
})

/** Collects the query keys the loader warms, without running a single query. */
function recordingQueryClient() {
  const warmed: unknown[][] = []
  return {
    warmed,
    queryClient: {
      ensureQueryData: (queryOptions: { queryKey: unknown[] }) => {
        warmed.push(queryOptions.queryKey)
        return Promise.resolve(undefined)
      },
    },
  }
}

function flagsContext(queryClient: unknown) {
  return { settings: { featureFlags: { supportInbox: true, supportTickets: true } }, queryClient }
}

/**
 * The warmed keys as one searchable string.
 *
 * Matching whole array elements instead was the first version of this and
 * stated the contract wrongly in both directions: the list key packs every
 * facet into one pipe-delimited segment (`open|conversation||||4711||||||`),
 * so an accepted value was not found, and — worse — a rejected value would not
 * have been found either, which is the assertion that has to bite.
 */
function warmedKeyText(warmed: unknown[][]): string {
  return JSON.stringify(warmed)
}

describe('the inbox loader (E1, E9)', () => {
  it('has no loaderDeps, so selecting a row cannot re-run it (E1)', () => {
    expect(options.loaderDeps).toBeUndefined()
  })

  it('warms the same open item the page will read from ?c= (E9)', async () => {
    const id = generateId('conversation')
    const { warmed, queryClient } = recordingQueryClient()

    await options.loader({ context: flagsContext(queryClient), location: { search: { c: id } } })

    expect(warmedKeyText(warmed)).toContain(id)
  })

  it('never forwards a facet the normalizer rejected (E9)', async () => {
    const poison = 'conversation_tag_not_a_real_id'
    const { warmed, queryClient } = recordingQueryClient()

    await options.loader({
      context: flagsContext(queryClient),
      location: { search: { tag: poison, segment: poison, company: poison, i: poison, q: 4711 } },
    })

    const keys = warmedKeyText(warmed)
    expect(keys).not.toContain(poison)
    // The one value on that URL the normalizer accepts does arrive, so the
    // assertion above is not passing because nothing was warmed at all.
    expect(keys).toContain('4711')
  })

  it('warms nothing when neither support product is on', async () => {
    const { warmed, queryClient } = recordingQueryClient()

    await options.loader({
      context: { settings: { featureFlags: {} }, queryClient },
      location: { search: {} },
    })

    expect(warmed).toEqual([])
  })

  it('survives a prefetch that fails, so a stale deep link cannot break the page', async () => {
    const queryClient = {
      ensureQueryData: vi.fn(() => Promise.reject(new Error('the list query failed'))),
    }

    await expect(
      options.loader({ context: flagsContext(queryClient), location: { search: {} } })
    ).resolves.toEqual({})
    expect(queryClient.ensureQueryData).toHaveBeenCalled()
  })
})

describe('list ordering (E8)', () => {
  it('treats a priority or SLA change as a reason to reorder the queues', () => {
    const conversationChanged = (patch: Partial<ConversationDTO>): ConversationStreamEvent =>
      ({ kind: 'conversation', conversation: patch as ConversationDTO }) as ConversationStreamEvent

    expect(agentEventChangesInboxList(conversationChanged({ priority: 'urgent' }))).toBe(true)
    expect(
      agentEventChangesInboxList(
        conversationChanged({
          sla: { firstResponseDueAt: '2026-01-01T00:00:00Z' } as ConversationDTO['sla'],
        })
      )
    ).toBe(true)
    // A typing signal moves nothing, so the assertion above is about the event
    // kind rather than about the predicate answering true to everything.
    expect(
      agentEventChangesInboxList({
        kind: 'typing',
        conversationId: generateId('conversation'),
        side: 'agent',
        at: '2026-01-01T00:00:00Z',
      } as ConversationStreamEvent)
    ).toBe(false)
  })
})
