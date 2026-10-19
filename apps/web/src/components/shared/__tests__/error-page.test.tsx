// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import fc from 'fast-check'

import {
  DefaultErrorPage,
  errorMessage,
  isAuthorizationError,
  isEntitlementError,
} from '../error-page'

/*
 * Contract for reading a route error. TanStack Router types what a route threw
 * as `unknown`: a loader can throw a string or a plain object, not only an Error.
 *
 * V1 A thrown Error shows its own message.
 * V2 A thrown string is the message.
 * V3 A thrown object carrying a string `message` shows that message, whether or
 *    not it is an Error.
 * V4 Anything else shows the generic sentence, never "undefined", "[object
 *    Object]" or a crash.
 * V5 A role-gate refusal is recognised however it was thrown, so a string or
 *    plain-object "Access denied" still gets the permission notice, not the raw
 *    jargon.
 */
const GENERIC_MESSAGE = 'An unexpected error occurred'

describe('errorMessage', () => {
  it('reads the message of an Error, a string and a message-bearing object alike (V1, V2, V3)', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(errorMessage(new Error(text))).toBe(text)
        expect(errorMessage(text)).toBe(text)
        expect(errorMessage({ message: text, status: 500 })).toBe(text)
      })
    )
  })

  it('falls back to the generic sentence for anything without a string message (V4)', () => {
    const withoutStringMessage = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.integer(),
      fc.boolean(),
      fc.record({ code: fc.string() }),
      fc.record({ message: fc.oneof(fc.integer(), fc.constant(null), fc.array(fc.string())) })
    )
    fc.assert(
      fc.property(withoutStringMessage, (thrown) => {
        expect(errorMessage(thrown)).toBe(GENERIC_MESSAGE)
      })
    )
  })
})

describe('isAuthorizationError', () => {
  it('flags the role-gate failures thrown by requireAuth', () => {
    expect(isAuthorizationError(new Error('Access denied: Requires [admin], got member'))).toBe(
      true
    )
    expect(isAuthorizationError(new Error('Access denied: Not a team member'))).toBe(true)
  })

  it('ignores unrelated runtime errors', () => {
    expect(isAuthorizationError(new Error('Network request failed'))).toBe(false)
    expect(isAuthorizationError(new Error('undefined is not a function'))).toBe(false)
  })
})

describe('isEntitlementError', () => {
  it('flags a named plan refusal', () => {
    expect(
      isEntitlementError(
        new Error(
          'The audit log is a Scale feature. Your workspace is on Pro. Upgrade to Scale to enable it.'
        )
      )
    ).toBe(true)
    expect(
      isEntitlementError(
        new Error('Workflows are not included in your plan. Contact us to enable it.')
      )
    ).toBe(true)
  })

  it('ignores unrelated runtime errors', () => {
    expect(isEntitlementError(new Error('boom'))).toBe(false)
    expect(isEntitlementError(new Error('Access denied: Requires [admin], got member'))).toBe(false)
  })
})

describe('DefaultErrorPage', () => {
  afterEach(() => cleanup())

  it('shows a friendly permission notice for authorization errors', () => {
    render(<DefaultErrorPage error={new Error('Access denied: Requires [admin], got member')} />)

    expect(screen.getByText(/don't have access/i)).toBeInTheDocument()
    // The raw role-gate jargon must never reach the user.
    expect(screen.queryByText(/Requires \[admin\]/)).toBeNull()
    expect(screen.queryByText(/Technical details/i)).toBeNull()
    expect(screen.queryByText(/Something went wrong/i)).toBeNull()
  })

  it('keeps the generic error treatment for everything else', () => {
    render(<DefaultErrorPage error={new Error('boom')} />)

    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument()
    expect(screen.getByText(/Technical details/i)).toBeInTheDocument()
  })

  it('does not treat a plan refusal as an unexpected crash', () => {
    render(
      <DefaultErrorPage
        error={
          new Error(
            'The audit log is a Scale feature. Your workspace is on Pro. Upgrade to Scale to enable it.'
          )
        }
      />
    )

    expect(screen.queryByText(/Something went wrong/i)).toBeNull()
    expect(screen.queryByText(/Technical details/i)).toBeNull()
    expect(
      screen.getByRole('heading', { name: 'The audit log is available from the Scale plan' })
    ).toBeInTheDocument()
    expect(screen.getByText(/The audit log is a Scale feature/)).toBeInTheDocument()
  })

  it('keeps the generic plan headline when the refusal names no plan', () => {
    render(
      <DefaultErrorPage
        error={new Error('Workflows are not included in your plan. Contact us to enable it.')}
      />
    )

    expect(screen.getByRole('heading', { name: 'This is a plan feature' })).toBeInTheDocument()
  })
})

describe('DefaultErrorPage with a non-Error thrown value', () => {
  afterEach(() => cleanup())

  it('shows the permission notice for a role-gate refusal thrown as a string (V5)', () => {
    render(<DefaultErrorPage error="Access denied: Requires [admin], got member" />)

    expect(screen.getByText(/don't have access/i)).toBeInTheDocument()
    expect(screen.queryByText(/Requires \[admin\]/)).toBeNull()
  })

  it('shows the permission notice for a role-gate refusal thrown as a plain object (V5)', () => {
    render(<DefaultErrorPage error={{ message: 'Access denied: Not a team member' }} />)

    expect(screen.getByText(/don't have access/i)).toBeInTheDocument()
  })

  it('treats a plan refusal thrown as a plain object as a plan refusal (V3)', () => {
    render(
      <DefaultErrorPage
        error={{ message: 'Workflows are not included in your plan. Contact us to enable it.' }}
      />
    )

    expect(screen.queryByText(/Something went wrong/i)).toBeNull()
    expect(screen.getByText(/not included in your plan/i)).toBeInTheDocument()
  })

  it('shows the generic sentence, not "undefined", for a value with no message (V4)', () => {
    render(<DefaultErrorPage error={42} />)

    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument()
    expect(screen.getByText(GENERIC_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText(/undefined|\[object Object\]/)).toBeNull()
  })
})
