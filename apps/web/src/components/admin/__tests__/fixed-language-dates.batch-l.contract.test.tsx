// @vitest-environment happy-dom
/**
 * A date inside an English admin sentence stays English on a German page.
 *
 * Contract for batch L (upstream #625 372fcb6f2, #630 16938dc59), confirmed
 * 2026-10-07 -- the item this suite pins, verbatim:
 *
 *   T4 A date inside copy of a fixed language (an English admin sentence)
 *      stays in that language, so a sentence never mixes languages.
 *
 * Every check renders under the shipped German catalogue and asserts the
 * whole sentence in English, next to a witness that the same date unpinned
 * would have read German -- otherwise an English result would prove nothing.
 * The primitives are checked across the server render and hydration; the
 * admin sentences are checked as rendered components.
 */
import { act, type ReactNode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { GermanIntlWrapper, renderInGerman } from '@/test/render-with-intl'
import { formatIn, restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'
import { LocalDate } from '@/components/ui/local-date'
import { getTimeAgo, TimeAgo } from '@/components/ui/time-ago'
import { WidgetLastDetected } from '@/components/admin/settings/widget/widget-last-detected'
import { ConnectionCard } from '@/components/admin/settings/security/identity-providers/connection-card'
import { RecoveryCodesSection } from '@/components/admin/settings/security/sso/recovery-codes-section'
import { InviteDate } from '@/components/admin/settings/team/pending-invitations'
import { InviteRow } from '@/components/admin/users/invite-row'

vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }))
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({ baseUrl: 'https://app.example.com' }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/server/functions/sso', () => ({ setProviderCredentialsFn: vi.fn() }))
vi.mock('@/lib/server/functions/recovery-codes', () => ({ generateRecoveryCodesFn: vi.fn() }))
vi.mock('@/lib/server/functions/admin', () => ({
  cancelInvitationFn: vi.fn(),
  resendInvitationFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/portal-invites', () => ({ getPortalInviteLinkFn: vi.fn() }))
vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    recoveryCodes: () => ({
      queryKey: ['admin', 'recoveryCodes'],
      queryFn: async () => ({ codes: [] }),
      staleTime: Infinity,
    }),
  },
}))
// The summary is under test, not the test flow or the editor behind "Edit".
vi.mock('@/components/admin/settings/security/identity-providers/use-connection-test', () => ({
  useConnectionTest: () => ({ openTest: vi.fn() }),
  useProviderCapture: () => connectionCapture.current,
}))
vi.mock('@/components/admin/settings/security/identity-providers/use-provider-save', () => ({
  useProviderSave: () => ({ saving: false, save: vi.fn(), saveClaimMapping: vi.fn() }),
}))
vi.mock('@/components/admin/settings/security/identity-providers/outcome-preview-rail', () => ({
  TestDetails: () => null,
}))
vi.mock('@/lib/shared/sso-mapping-preview', () => ({
  previewClaimMapping: () => ({ status: 'resolved', identity: null }),
}))

const connectionCapture = vi.hoisted(() => ({ current: null as unknown }))

const NOW = new Date('2026-10-07T12:00:00.000Z')
const THREE_DAYS_AGO = '2026-10-04T12:00:00.000Z'
const DAY: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }

afterEach(() => {
  vi.useRealTimers()
  restoreRuntimeLocale()
  connectionCapture.current = null
})

function atNow() {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(NOW)
}

/** Server-renders `ui` on a German page, then hydrates it in a German browser in another zone. */
async function serverThenHydrateInGerman(ui: ReactNode) {
  const tree = <GermanIntlWrapper>{ui}</GermanIntlWrapper>
  setRuntimeLocale('en-US', 'UTC')
  const container = document.createElement('div')
  container.innerHTML = renderToString(tree)
  const serverText = container.textContent

  setRuntimeLocale('de-DE', 'Pacific/Kiritimati')
  const errors: unknown[] = []
  let root!: ReturnType<typeof hydrateRoot>
  await act(async () => {
    root = hydrateRoot(container, tree, { onRecoverableError: (error) => errors.push(error) })
  })
  const hydratedText = container.textContent
  act(() => root.unmount())
  return { serverText, hydratedText, errors }
}

describe('the primitives keep a pinned language on a German page', () => {
  it('(T4) a LocalDate pinned to en-US is English in both renders', async () => {
    const at = '2026-10-01T20:30:00.000Z'
    const pinned = await serverThenHydrateInGerman(
      <p>
        Sent <LocalDate date={at} options={DAY} locale="en-US" />
      </p>
    )
    const unpinned = await serverThenHydrateInGerman(<LocalDate date={at} options={DAY} />)

    expect(pinned.errors).toEqual([])
    expect(pinned.serverText).toBe('Sent Oct 1, 2026')
    expect(pinned.hydratedText).toBe('Sent Oct 2, 2026')
    expect(unpinned.hydratedText).toBe(formatIn('de', 'Pacific/Kiritimati', at, DAY))
    expect(unpinned.hydratedText).toBe('2. Okt. 2026')
  })

  it('(T4) a TimeAgo pinned to en is English in both renders', async () => {
    atNow()
    const pinned = await serverThenHydrateInGerman(
      <p>
        Updated <TimeAgo date={THREE_DAYS_AGO} locale="en" />
      </p>
    )
    const unpinned = await serverThenHydrateInGerman(<TimeAgo date={THREE_DAYS_AGO} />)

    expect(pinned.errors).toEqual([])
    expect(pinned.serverText).toBe('Updated 3 days ago')
    expect(pinned.hydratedText).toBe('Updated 3 days ago')
    expect(unpinned.hydratedText).toBe('vor 3 Tagen')
  })
})

describe('the English admin sentences stay English on a German page', () => {
  it('(T4) "Last detected" on the widget settings', () => {
    atNow()
    renderInGerman(<WidgetLastDetected at={THREE_DAYS_AGO} />)

    expect(screen.getByText(/Last detected/).textContent).toBe('Last detected 3 days ago')
    expect(getTimeAgo(THREE_DAYS_AGO, 'de')).toBe('vor 3 Tagen')
  })

  it('(T4) "Tested" on a verified identity provider, with and without a test account', () => {
    atNow()
    const provider = {
      id: 'idp_x',
      registrationId: 'oidc_x',
      configured: true,
      lastSuccessfulTestAt: THREE_DAYS_AGO,
      detailsChangedAt: '2026-09-01T00:00:00.000Z',
      claimMapping: null,
      autoCreateUsers: true,
      autoProvisionRole: 'user',
      enabled: true,
    } as unknown as IdentityProvider

    const anonymous = renderInGerman(<ConnectionCard provider={provider} />)
    expect(screen.getByText(/Connected · Tested/).textContent).toBe('Connected · Tested 3 days ago')
    anonymous.unmount()

    connectionCapture.current = { identity: { name: 'Ada Admin', email: 'ada@example.com' } }
    renderInGerman(<ConnectionCard provider={provider} />)
    expect(screen.getByText('Connected as Ada Admin')).toBeInTheDocument()
    expect(screen.getByText(/· Tested/).textContent).toBe('· Tested 3 days ago')
  })

  it('(T4) "Last generated" on the recovery codes', async () => {
    setRuntimeLocale('de-DE', 'Pacific/Kiritimati')
    const createdAt = '2026-10-01T20:30:00.000Z'
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['admin', 'recoveryCodes'], {
      codes: [{ id: 'rc_1', createdAt, usedAt: null }],
    })

    renderInGerman(
      <QueryClientProvider client={client}>
        <RecoveryCodesSection />
      </QueryClientProvider>
    )

    const sentence = screen.getByText(/Last generated/)
    expect(sentence.textContent).toBe(
      `Last generated ${formatIn('en-US', 'Pacific/Kiritimati', createdAt)}`
    )
    expect(sentence.textContent).toBe('Last generated 10/2/2026')
    expect(formatIn('de', 'Pacific/Kiritimati', createdAt)).toBe('2.10.2026')
  })

  it('(T4) "Sent" on a portal invite and the team invitation date', () => {
    setRuntimeLocale('de-DE', 'Pacific/Kiritimati')
    const sentAt = '2026-10-01T20:30:00.000Z'
    const invite = {
      id: 'inv_1',
      email: 'ada@example.com',
      status: 'accepted',
      createdAt: sentAt,
      lastSentAt: sentAt,
    }

    const row = renderInGerman(
      <InviteRow
        invite={invite}
        onRevoke={vi.fn()}
        onResend={vi.fn()}
        revoking={false}
        resending={false}
      />
    )
    expect(screen.getByText(/^Sent/).textContent).toBe('Sent Oct 2')
    row.unmount()

    renderInGerman(<InviteDate date={sentAt} />)
    expect(screen.getByText('Oct 2')).toBeInTheDocument()
    expect(formatIn('de', 'Pacific/Kiritimati', sentAt, { month: 'short', day: 'numeric' })).toBe(
      '2. Okt.'
    )
  })
})
