/**
 * The changelog subscription service, with the database stubbed.
 *
 * Contract (upstream #687), verbatim:
 *
 *   U1 Opening an unsubscribe link never unsubscribes anyone. It shows what would happen and asks for confirmation.
 *   U2 The unsubscribe happens only on an explicit confirmation, or on a one-click request from the mail provider.
 *   U3 A malformed, unknown, used or expired token shows the expired-link page, never a server error.
 *   U4 A one-click request in the RFC 8058 form is answered with success for every token, whether live, used, unknown or malformed. A request without the one-click body is refused. A body larger than 1 KB is refused without reading more than the chunk that crosses 1 KB.
 *   U5 A token is spent only once the opt-out has actually happened. If the opt-out fails, the link keeps working and a retry succeeds exactly once.
 *   U6 Unsubscribing from the changelog also stops the changelog mail that reaches a person through posts they follow, even if they never subscribed to the changelog.
 *   U7 Every notification email that has a tokenised unsubscribe link carries List-Unsubscribe. It offers one-click only when the link is HTTPS. An email without such a link carries neither header; a link to the notification preferences is not an unsubscribe link.
 *   U8 The unsubscribe page is in the language the rest of the site resolved for the request, in all nine languages, and the German addresses the reader formally.
 *   U9 The unsubscribe page's strings are not loaded into the portal or the widget.
 *
 * Only the unsubscribeChangelog test here belongs to that contract (U6); the
 * behaviour against real rows is in events/__tests__/changelog-unsubscribe-targets.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId } from '@quackback/ids'

const mockInsertValues = vi.fn()
const mockOnConflictDoNothing = vi.fn()
const mockOnConflictDoUpdate = vi.fn()
const mockUpdateSet = vi.fn()
const mockUpdateWhere = vi.fn()
const mockSubFindFirst = vi.fn()
const mockGetChangelogSettings = vi.fn()

vi.mock('@/lib/server/domains/settings/settings.changelog', () => ({
  getChangelogSettings: () => mockGetChangelogSettings(),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      changelogSubscriptions: { findFirst: (...args: unknown[]) => mockSubFindFirst(...args) },
    },
    insert: () => ({
      values: (values: unknown) => {
        mockInsertValues(values)
        return {
          onConflictDoNothing: (...args: unknown[]) => mockOnConflictDoNothing(...args),
          onConflictDoUpdate: (...args: unknown[]) => mockOnConflictDoUpdate(...args),
        }
      },
    }),
    update: () => ({
      set: (values: unknown) => {
        mockUpdateSet(values)
        return { where: (...args: unknown[]) => mockUpdateWhere(...args) }
      },
    }),
  },
  eq: vi.fn(),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray) => ({ kind: 'sql', strings: Array.from(strings) })),
    { raw: vi.fn() }
  ),
}))

const PRINCIPAL_ID = 'principal_01user' as PrincipalId

beforeEach(() => {
  vi.clearAllMocks()
  mockGetChangelogSettings.mockResolvedValue({ autoSubscribe: true, emailsDisabled: false })
})

describe('ensureAutoSubscribed', () => {
  it('is a no-op when autoSubscribe is off', async () => {
    mockGetChangelogSettings.mockResolvedValue({ autoSubscribe: false, emailsDisabled: false })
    const { ensureAutoSubscribed } = await import('../changelog-subscription.service')

    await ensureAutoSubscribed(PRINCIPAL_ID)

    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('inserts a source=auto row with onConflictDoNothing when autoSubscribe is on', async () => {
    const { ensureAutoSubscribed } = await import('../changelog-subscription.service')

    await ensureAutoSubscribed(PRINCIPAL_ID)

    expect(mockInsertValues).toHaveBeenCalledWith({ principalId: PRINCIPAL_ID, source: 'auto' })
    expect(mockOnConflictDoNothing).toHaveBeenCalledTimes(1)
  })
})

describe('subscribeSelfServe / subscribeAdmin', () => {
  it('upserts with onConflictDoUpdate clearing unsubscribedAt', async () => {
    const { subscribeSelfServe } = await import('../changelog-subscription.service')

    await subscribeSelfServe(PRINCIPAL_ID)

    expect(mockInsertValues).toHaveBeenCalledWith({
      principalId: PRINCIPAL_ID,
      source: 'self_serve',
    })
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: { unsubscribedAt: null } })
    )
  })

  it('subscribeAdmin uses source=admin', async () => {
    const { subscribeAdmin } = await import('../changelog-subscription.service')

    await subscribeAdmin(PRINCIPAL_ID)

    expect(mockInsertValues).toHaveBeenCalledWith({ principalId: PRINCIPAL_ID, source: 'admin' })
  })
})

describe('unsubscribeChangelog', () => {
  // Behaviour against real rows (a principal with no row, and keeping an
  // existing row's source) is covered by changelog-unsubscribe-targets.db.test.ts.
  it('(U6) upserts an opted-out row, stamping only unsubscribedAt on conflict', async () => {
    const { unsubscribeChangelog } = await import('../changelog-subscription.service')

    await unsubscribeChangelog(PRINCIPAL_ID)

    expect(mockInsertValues).toHaveBeenCalledWith({
      principalId: PRINCIPAL_ID,
      source: 'self_serve',
      unsubscribedAt: expect.any(Date),
    })
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: { unsubscribedAt: expect.any(Date) } })
    )
  })
})

describe('getChangelogSubscriptionStatus', () => {
  it('reports unsubscribed=false shape when no row exists', async () => {
    mockSubFindFirst.mockResolvedValueOnce(undefined)
    const { getChangelogSubscriptionStatus } = await import('../changelog-subscription.service')

    const status = await getChangelogSubscriptionStatus(PRINCIPAL_ID)

    expect(status).toEqual({
      principalId: PRINCIPAL_ID,
      subscribed: false,
      source: null,
      unsubscribedAt: null,
    })
  })

  it('subscribed=true when unsubscribedAt is null on an existing row', async () => {
    mockSubFindFirst.mockResolvedValueOnce({
      principalId: PRINCIPAL_ID,
      source: 'auto',
      unsubscribedAt: null,
    })
    const { getChangelogSubscriptionStatus } = await import('../changelog-subscription.service')

    const status = await getChangelogSubscriptionStatus(PRINCIPAL_ID)

    expect(status.subscribed).toBe(true)
  })

  it('subscribed=false when unsubscribedAt is set', async () => {
    const unsubscribedAt = new Date('2026-01-01')
    mockSubFindFirst.mockResolvedValueOnce({
      principalId: PRINCIPAL_ID,
      source: 'self_serve',
      unsubscribedAt,
    })
    const { getChangelogSubscriptionStatus } = await import('../changelog-subscription.service')

    const status = await getChangelogSubscriptionStatus(PRINCIPAL_ID)

    expect(status.subscribed).toBe(false)
    expect(status.unsubscribedAt).toBe(unsubscribedAt)
  })
})

describe('importChangelogSubscribersFromEmails', () => {
  it('returns all-zero result for an empty input', async () => {
    const { importChangelogSubscribersFromEmails } =
      await import('../changelog-subscription.service')

    const result = await importChangelogSubscribersFromEmails([])

    expect(result).toEqual({ imported: 0, skipped: 0, total: 0 })
    expect(mockInsertValues).not.toHaveBeenCalled()
  })
})
