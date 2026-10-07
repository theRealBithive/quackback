/**
 * The /unsubscribe page and its server functions must never throw on a token
 * that is merely malformed. Mail scanners rewrite and truncate links, and a
 * string that passes a loose hex pattern but is not a real UUID used to slip
 * past the page and then fail the server function's stricter schema, which
 * surfaced as a 500.
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
 * This module holds U1, U2, U3 and the locale hand-off half of U8; the real
 * catalogue text is asserted in unsubscribe-page.test.tsx.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  processUnsubscribeToken: vi.fn(),
  previewUnsubscribeToken: vi.fn(),
  loadUnsubscribeIntl: vi.fn(),
}))

vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  processUnsubscribeToken: hoisted.processUnsubscribeToken,
  previewUnsubscribeToken: hoisted.previewUnsubscribeToken,
}))

// Outside the Start compiler a server function never reaches its handler, so
// this runs the handler in-process. The validator is applied for real: a
// schema that throws on a malformed token is exactly what this suite guards.
vi.mock('@tanstack/react-start', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start')>()),
  createServerFn: () => {
    let validate = (data: unknown) => data
    const chain: Record<string, unknown> = {}
    chain.validator = (schema: { parse: (data: unknown) => unknown }) => {
      validate = (data) => schema.parse(data)
      return chain
    }
    chain.handler =
      (handler: (args: { data: unknown }) => Promise<unknown>) => (args?: { data?: unknown }) =>
        Promise.resolve().then(() => handler({ data: validate(args?.data) }))
    return chain
  },
}))

vi.mock('@/lib/server/functions/locale', () => ({
  loadUnsubscribeIntl: hoisted.loadUnsubscribeIntl,
}))

import { Route } from '../unsubscribe'
import {
  previewUnsubscribeTokenFn,
  processUnsubscribeTokenFn,
} from '@/lib/server/functions/subscriptions'

/** Passes /^[0-9a-f-]{36}$/ but is not a UUID: the version nibble is 0. */
const NOT_A_UUID = '12345678-1234-0234-8234-123456789abc'
const VALID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'

interface LoaderContext {
  resolvedLocale?: string
}

const loader = (
  Route.options as unknown as {
    loader: (ctx: { deps: { token?: string }; context: LoaderContext }) => Promise<unknown>
  }
).loader

/** Opens the page the way the router does, with the locale bootstrap resolved. */
function openPage(token: string | undefined, context: LoaderContext = { resolvedLocale: 'en' }) {
  return loader({ deps: { token }, context })
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.previewUnsubscribeToken.mockResolvedValue({ action: 'unsubscribe_all' })
  hoisted.loadUnsubscribeIntl.mockImplementation(async (locale: string) => ({
    locale,
    messages: {},
  }))
  hoisted.processUnsubscribeToken.mockResolvedValue({
    action: 'unsubscribe_all',
    principalId: 'principal_x',
    postId: null,
  })
})

describe('/unsubscribe loader', () => {
  it('(U3) shows the invalid view for a token that only looks like a UUID', async () => {
    await expect(openPage(NOT_A_UUID)).resolves.toMatchObject({
      status: 'error',
      error: 'invalid',
    })
    expect(hoisted.processUnsubscribeToken).not.toHaveBeenCalled()
    expect(hoisted.previewUnsubscribeToken).not.toHaveBeenCalled()
  })

  it('(U3) shows the invalid view for garbage and the missing view for no token', async () => {
    await expect(openPage('abc')).resolves.toMatchObject({ error: 'invalid' })
    await expect(openPage(undefined)).resolves.toMatchObject({ error: 'missing' })
  })

  it('(U1) looks a valid token up without consuming it', async () => {
    await expect(openPage(VALID)).resolves.toMatchObject({
      status: 'confirm',
      action: 'unsubscribe_all',
    })
    expect(hoisted.previewUnsubscribeToken).toHaveBeenCalledWith(VALID)
    expect(hoisted.processUnsubscribeToken).not.toHaveBeenCalled()
  })
})

describe('processUnsubscribeTokenFn', () => {
  it('(U3) returns the typed invalid result for a malformed token instead of throwing', async () => {
    await expect(processUnsubscribeTokenFn({ data: { token: NOT_A_UUID } })).resolves.toEqual({
      success: false,
      error: 'invalid',
    })
    expect(hoisted.processUnsubscribeToken).not.toHaveBeenCalled()
  })

  it('(U2) processes a well-formed token on confirmation', async () => {
    await expect(processUnsubscribeTokenFn({ data: { token: VALID } })).resolves.toMatchObject({
      success: true,
      action: 'unsubscribe_all',
    })
    expect(hoisted.processUnsubscribeToken).toHaveBeenCalledWith(VALID)
  })
})

describe('/unsubscribe loader language', () => {
  it('(U8) seeds the catalogue in the language bootstrap resolved for the request', async () => {
    const data = await openPage(VALID, { resolvedLocale: 'de' })

    expect(hoisted.loadUnsubscribeIntl).toHaveBeenCalledTimes(1)
    expect(hoisted.loadUnsubscribeIntl).toHaveBeenCalledWith('de')
    expect(data).toMatchObject({ locale: 'de', status: 'confirm' })
  })

  it('(U8) falls back to the default language when nothing was resolved', async () => {
    const data = await openPage(VALID, {})

    expect(hoisted.loadUnsubscribeIntl).toHaveBeenCalledWith('en')
    expect(data).toMatchObject({ locale: 'en' })
  })
})

describe('previewUnsubscribeTokenFn', () => {
  it('(U3) answers a malformed token with the invalid view without a lookup', async () => {
    await expect(previewUnsubscribeTokenFn({ data: { token: NOT_A_UUID } })).resolves.toEqual({
      status: 'error',
      error: 'invalid',
    })
    expect(hoisted.previewUnsubscribeToken).not.toHaveBeenCalled()
  })

  it('(U3) answers an unknown, used or expired token with the invalid view', async () => {
    hoisted.previewUnsubscribeToken.mockResolvedValue(null)

    await expect(previewUnsubscribeTokenFn({ data: { token: VALID } })).resolves.toEqual({
      status: 'error',
      error: 'invalid',
    })
  })

  it('(U3) answers a failing lookup with the failed view instead of throwing', async () => {
    hoisted.previewUnsubscribeToken.mockRejectedValue(new Error('connection terminated'))

    await expect(previewUnsubscribeTokenFn({ data: { token: VALID } })).resolves.toEqual({
      status: 'error',
      error: 'failed',
    })
  })

  it('(U1) says what a live token would do, post title included, and spends nothing', async () => {
    hoisted.previewUnsubscribeToken.mockResolvedValue({
      action: 'unsubscribe_post',
      postTitle: 'Dark mode',
    })

    await expect(previewUnsubscribeTokenFn({ data: { token: VALID } })).resolves.toEqual({
      status: 'confirm',
      action: 'unsubscribe_post',
      postTitle: 'Dark mode',
    })
    expect(hoisted.processUnsubscribeToken).not.toHaveBeenCalled()
  })
})

describe('processUnsubscribeTokenFn outcomes', () => {
  it('(U3) answers a token the service no longer accepts with the invalid result', async () => {
    hoisted.processUnsubscribeToken.mockResolvedValue(null)

    await expect(processUnsubscribeTokenFn({ data: { token: VALID } })).resolves.toEqual({
      success: false,
      error: 'invalid',
    })
  })

  it('(U3) answers a failing opt-out with the failed result instead of throwing', async () => {
    hoisted.processUnsubscribeToken.mockRejectedValue(new Error('connection terminated'))

    await expect(processUnsubscribeTokenFn({ data: { token: VALID } })).resolves.toEqual({
      success: false,
      error: 'failed',
    })
  })
})
