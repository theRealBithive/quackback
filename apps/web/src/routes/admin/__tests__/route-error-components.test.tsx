// @vitest-environment happy-dom
/**
 * The Users and Feedback inbox pages render their own error alert instead of
 * the shared error page. TanStack Router types what a loader threw as
 * `unknown`, so these alerts must read a message from whatever arrived.
 *
 * Same contract as `components/shared/__tests__/error-page.test.tsx`:
 *
 * V1 A thrown Error shows its own message.
 * V2 A thrown string is the message.
 * V4 Anything else shows the generic sentence, never "undefined", "[object
 *    Object]" or a crash.
 */
import { describe, it, expect, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'

import { Route as UsersRoute } from '../users'
import { Route as FeedbackRoute } from '../feedback.index'

type AlertProps = { error: unknown; reset: () => void }

const routes = [
  { page: 'Users', heading: /Failed to load users/i, route: UsersRoute },
  { page: 'Feedback inbox', heading: /Failed to load feedback/i, route: FeedbackRoute },
]

function renderAlert(route: (typeof routes)[number]['route'], error: unknown) {
  const ErrorAlert = route.options.errorComponent as ComponentType<AlertProps>
  render(<ErrorAlert error={error} reset={() => {}} />)
}

describe.each(routes)('$page error alert', ({ heading, route }) => {
  afterEach(() => cleanup())

  it('shows the message of a thrown Error (V1)', () => {
    renderAlert(route, new Error('database unreachable'))

    expect(screen.getByText(heading)).toBeInTheDocument()
    expect(screen.getByText('database unreachable')).toBeInTheDocument()
  })

  it('shows a thrown string as the message (V2)', () => {
    renderAlert(route, 'segment lookup timed out')

    expect(screen.getByText('segment lookup timed out')).toBeInTheDocument()
  })

  it('shows the generic sentence for a value with no message (V4)', () => {
    renderAlert(route, { code: 503 })

    expect(screen.getByText('An unexpected error occurred')).toBeInTheDocument()
    expect(screen.queryByText(/undefined|\[object Object\]/)).toBeNull()
  })
})
