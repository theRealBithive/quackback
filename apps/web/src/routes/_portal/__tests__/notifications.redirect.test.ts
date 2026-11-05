/**
 * The portal notifications page is for signed-in users only.
 *
 * Contract (confirmed 2026-11-05):
 *   N1 An anonymous visitor to /notifications is redirected to the portal home.
 *   N2 A signed-in visitor stays on /notifications.
 */
import { describe, expect, it } from 'vitest'
import { isRedirect } from '@tanstack/react-router'
import { Route } from '../notifications'

type BeforeLoad = (args: { context: { session: unknown } }) => unknown

function runBeforeLoad(session: unknown): unknown {
  const beforeLoad = Route.options.beforeLoad as unknown as BeforeLoad
  try {
    beforeLoad({ context: { session } })
    return undefined
  } catch (thrown) {
    return thrown
  }
}

describe('/notifications access', () => {
  it('redirects a visitor without a session to the portal home (N1)', () => {
    const thrown = runBeforeLoad(null)

    expect(isRedirect(thrown)).toBe(true)
    expect((thrown as { options: { to: string } }).options.to).toBe('/')
  })

  it('redirects a session without a user to the portal home (N1)', () => {
    const thrown = runBeforeLoad({ user: null })

    expect(isRedirect(thrown)).toBe(true)
  })

  it('lets a signed-in visitor stay (N2)', () => {
    const thrown = runBeforeLoad({ user: { id: 'user_1' } })

    expect(thrown).toBeUndefined()
  })
})
