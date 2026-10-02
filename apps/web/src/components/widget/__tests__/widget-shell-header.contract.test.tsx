// @vitest-environment happy-dom
/**
 * Widget home header: whose face it shows.
 *
 * Contract for the batch F pick (upstream 546676b40, #571) -- the confirmed
 * list item this suite pins:
 *
 *   F4 The widget home header shows only the identified visitor's own avatar,
 *      never teammates' faces; an anonymous visitor sees none.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fc from 'fast-check'
import { cleanup, screen } from '@testing-library/react'
import { renderInGerman } from '@/test/render-with-intl'

const authState: {
  user: { name: string; email: string; avatarUrl: string | null } | null
  isIdentified: boolean
} = { user: null, isIdentified: false }

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    user: authState.user,
    isIdentified: authState.isIdentified,
    hmacRequired: false,
    canPortalHandoff: true,
    closeWidget: vi.fn(),
    sessionVersion: 1,
  }),
}))
vi.mock('../use-messenger-unread', () => ({ useMessengerUnread: () => 0 }))
vi.mock('../use-changelog-unread', () => ({
  useChangelogUnread: () => ({ unread: 0, markSeen: vi.fn() }),
}))
vi.mock('../use-ticket-stage-badge', () => ({
  useTicketStageBadge: () => ({ unread: 0, hasTickets: false }),
}))
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => ({}),
  generateOneTimeToken: vi.fn(),
}))
vi.mock('@/components/shared/user-stats', () => ({ UserStatsBar: () => null }))

import { WidgetShell } from '../widget-shell'
import de from '@/locales/de.json'

const GERMAN_USER_MENU = (de as Record<string, string>)['widget.shell.aria.userMenu']

function renderHome() {
  return renderInGerman(
    <WidgetShell
      orgSlug="acme"
      activeTab="home"
      onTabChange={() => {}}
      enabledTabs={{ feedback: true, messages: true }}
    >
      home
    </WidgetShell>
  )
}

function avatarsInPage(): Element[] {
  return [...document.querySelectorAll('[data-slot="avatar"]')]
}

const visitorArbitrary = fc.record({
  name: fc.stringMatching(/^[A-Z][a-z]{2,8} [A-Z][a-z]{2,8}$/),
  email: fc.emailAddress(),
  avatarUrl: fc.option(fc.constant('https://example.com/me.png'), { nil: null }),
})

beforeEach(() => {
  authState.user = null
  authState.isIdentified = false
})
afterEach(cleanup)

describe('widget home header', () => {
  it('(F4) shows exactly one avatar, the identified visitor own, whoever the visitor is', () => {
    expect(GERMAN_USER_MENU).not.toBe('User menu')
    fc.assert(
      fc.property(visitorArbitrary, (visitor) => {
        cleanup()
        authState.user = visitor
        authState.isIdentified = true
        renderHome()

        const menuButton = screen.getByRole('button', { name: GERMAN_USER_MENU })
        const avatars = avatarsInPage()
        expect(avatars).toHaveLength(1)
        expect(menuButton.contains(avatars[0])).toBe(true)
      }),
      { numRuns: 30 }
    )
  })

  it('(F4) shows the visitor initials on that avatar when there is no picture', () => {
    authState.user = { name: 'Ada Example', email: 'ada@example.com', avatarUrl: null }
    authState.isIdentified = true
    renderHome()

    expect(avatarsInPage().map((avatar) => avatar.textContent)).toEqual(['AE'])
  })

  it('(F4) shows no avatar at all to an anonymous visitor', () => {
    renderHome()

    expect(avatarsInPage()).toHaveLength(0)
    expect(screen.queryByRole('button', { name: GERMAN_USER_MENU })).toBeNull()
  })
})
