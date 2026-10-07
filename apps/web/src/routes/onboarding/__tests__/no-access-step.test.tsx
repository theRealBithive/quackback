// @vitest-environment happy-dom
/**
 * The terminal page of the onboarding wizard, for a caller who has nothing to
 * finish there.
 *
 * Contract (upstream #656), confirmed:
 *
 * O1 While setup is still open, the first person who signs in can claim the workspace and becomes its admin.
 * O2 Once setup is complete, nobody can claim the workspace through the onboarding step: not a portal user and not a teammate, even when no human admin is left.
 * O3 A refused claim changes nothing: the workspace's name, slug and modules stay as they were, and the caller keeps the role they had.
 * O4 A workspace that was marked complete by its config file before its owner ever arrived still counts as open, so its first person can claim it.
 * O5 When the setup state cannot be read unambiguously, the workspace counts as closed.
 *
 * The claim itself is `functions/__tests__/onboarding-bootstrap-claim.db.test.ts`.
 * This page is where O2 sends a non-admin on a finished install, so it must
 * keep them there and say the true thing: the workspace is already set up,
 * not that it was created for somebody else.
 *
 * Only English is asserted, and that proves less than it looks: the two ids
 * this page gained in #656 are in none of the nine catalogues yet, so the
 * English here is the `defaultMessage`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, screen } from '@testing-library/react'
import { renderWithIntl } from '@/test/render-with-intl'

const hoisted = vi.hoisted(() => ({ checkOnboardingState: vi.fn() }))

vi.mock('@/lib/server/functions/admin', () => ({
  checkOnboardingState: hoisted.checkOnboardingState,
}))
vi.mock('../-sign-out-button', () => ({ SignOutButton: () => <button>Sign out</button> }))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}))

import { Route } from '../_layout.no-access'

type LoaderData = { setupComplete: boolean; claimedByOther: boolean; alreadySetUp: boolean }

/** The state `checkOnboardingState` reports for a finished install with no human admin. */
function finishedInstallState(overrides: Record<string, unknown> = {}) {
  return {
    setupClaimedByOther: false,
    setupOpenToClaim: true,
    setupClosedReason: 'setupComplete',
    isOnboardingComplete: true,
    setupState: null,
    principalRecord: { id: 'p_visitor', role: 'user' },
    ...overrides,
  }
}

async function runLoader(): Promise<LoaderData> {
  const loader = Route.options.loader as unknown as (args: {
    context: { session: { user: { id: string } } }
  }) => Promise<LoaderData>
  return loader({ context: { session: { user: { id: 'u_visitor' } } } })
}

function renderPage(data: LoaderData) {
  vi.spyOn(Route, 'useLoaderData').mockReturnValue(data as never)
  const Page = Route.options.component as () => React.ReactElement
  return renderWithIntl(<Page />)
}

beforeEach(() => {
  hoisted.checkOnboardingState.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('no-access page: a finished install with no admin left (O2)', () => {
  it('keeps a non-admin here and marks the page as already set up', async () => {
    hoisted.checkOnboardingState.mockResolvedValue(finishedInstallState())

    const data = await runLoader()

    expect(data).toEqual({ setupComplete: true, claimedByOther: false, alreadySetUp: true })
  })

  it('says the workspace is already set up, not that it was made for someone', () => {
    renderPage({ setupComplete: true, claimedByOther: false, alreadySetUp: true })

    expect(screen.getByRole('heading', { name: /already set up/i })).toBeInTheDocument()
    expect(screen.getByText(/sign in with an admin account/i)).toBeInTheDocument()
    expect(screen.queryByText(/created for a specific account/i)).toBeNull()
  })

  // The control: an owner exists and it is somebody else. Same finished
  // setup, but this is the "belongs to an existing admin" page, so the
  // already-set-up copy must not take it over.
  it('keeps the existing-admin copy when another human owns setup', async () => {
    hoisted.checkOnboardingState.mockResolvedValue(
      finishedInstallState({ setupClaimedByOther: true })
    )

    const data = await runLoader()
    renderPage(data)

    expect(data.alreadySetUp).toBe(false)
    expect(
      screen.getByRole('heading', { name: /belongs to an existing admin/i })
    ).toBeInTheDocument()
  })

  // O1 from this side: while setup is open the page is not a dead end, and the
  // first person is sent on to the claim step.
  it('sends a non-admin on an open install on to the claim step (O1)', async () => {
    hoisted.checkOnboardingState.mockResolvedValue(
      finishedInstallState({ setupClosedReason: null, isOnboardingComplete: false })
    )

    await expect(runLoader()).rejects.toMatchObject({
      options: { to: '/onboarding/workspace' },
    })
  })
})
