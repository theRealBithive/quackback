/**
 * The RFC 8058 one-click endpoint, offline: the opt-out itself is stubbed, so
 * this module is about what the endpoint answers and what it lets through.
 * The same endpoint against a real database is in
 * routes/__tests__/unsubscribe-route.db.test.ts.
 *
 * Contract (upstream #687), verbatim:
 *
 *   U1 Opening an unsubscribe link never unsubscribes anyone. It shows what would happen and asks for confirmation.
 *   U2 The unsubscribe happens only on an explicit confirmation, or on a one-click request from the mail provider.
 *   U3 A malformed, unknown, used or expired token shows the expired-link page, never a server error.
 *   U4 A one-click request in the RFC 8058 form is answered with success for every token, whether live, used, unknown or malformed. A request without the one-click body is refused. A body larger than 1 KB is refused after reading no more than that.
 *   U5 A token is spent only once the opt-out has actually happened. If the opt-out fails, the link keeps working and a retry succeeds exactly once.
 *   U6 Unsubscribing from the changelog also stops the changelog mail that reaches a person through posts they follow, even if they never subscribed to the changelog.
 *   U7 Every notification email that has an unsubscribe link carries List-Unsubscribe. It offers one-click only when the link is HTTPS. An email without a link carries neither header.
 *   U8 The unsubscribe page is in the language the rest of the site resolved for the request, in all nine languages, and the German addresses the reader formally.
 *   U9 The unsubscribe page's strings are not loaded into the portal or the widget.
 *
 * This module holds U4, and the U5 half that belongs to this endpoint: a
 * failed opt-out is not answered as a success, so the provider retries.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

const hoisted = vi.hoisted(() => ({
  processUnsubscribeToken: vi.fn(),
  logLines: [] as string[],
}))

vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  processUnsubscribeToken: hoisted.processUnsubscribeToken,
}))

/** The endpoint's log, captured down to debug: what an operator would read. */
vi.mock('@/lib/server/logger', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/logger')>()
  const destination = { write: (line: string) => void hoisted.logLines.push(line) }
  return { ...original, logger: original.createLogger({ level: 'debug', destination }) }
})

function logged(): Array<Record<string, unknown>> {
  return hoisted.logLines.map((line) => JSON.parse(line))
}

import { handleOneClickUnsubscribe } from '../one-click-unsubscribe'

const ONE_KB = 1_024
const ONE_CLICK_BODY = 'List-Unsubscribe=One-Click'
const LIVE_TOKEN = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'
const FORM = { 'content-type': 'application/x-www-form-urlencoded' }

function linkFor(token: string | null): string {
  const url = new URL('https://acme.test/unsubscribe')
  if (token !== null) url.searchParams.set('token', token)
  return url.href
}

function oneClick(token: string | null, init: RequestInit = {}): Promise<Response> {
  return handleOneClickUnsubscribe(
    new Request(linkFor(token), { method: 'POST', headers: FORM, body: ONE_CLICK_BODY, ...init })
  )
}

/** A one-click body padded with a second field to exactly `bytes` bytes. */
function oneClickBodyOfSize(bytes: number): string {
  const prefix = `${ONE_CLICK_BODY}&pad=`
  return prefix + 'x'.repeat(bytes - prefix.length)
}

/**
 * A chunked body with no Content-Length that never ends, counting what was
 * pulled. With a high-water mark of zero the stream fetches nothing ahead of
 * a read, so what it counts is what the handler asked for.
 */
function endlessBody(chunkBytes: number) {
  const chunk = new TextEncoder().encode(oneClickBodyOfSize(chunkBytes))
  const counter = { pulled: 0 }
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        counter.pulled += chunk.byteLength
        controller.enqueue(chunk)
      },
    },
    { highWaterMark: 0 }
  )
  return { stream, counter }
}

function streamedRequest(stream: ReadableStream<Uint8Array>, headers: Record<string, string>) {
  return new Request(linkFor(LIVE_TOKEN), {
    method: 'POST',
    headers,
    body: stream,
    duplex: 'half',
  } as RequestInit)
}

beforeEach(() => {
  hoisted.logLines.length = 0
  hoisted.processUnsubscribeToken.mockReset()
  hoisted.processUnsubscribeToken.mockResolvedValue({
    action: 'unsubscribe_all',
    principalId: 'principal_x',
    postId: null,
  })
})

describe('a one-click request in the RFC 8058 form', () => {
  it('(U4) is answered with success whatever the token is', async () => {
    const tokenShape = fc.oneof(
      fc.record({ kind: fc.constant('minted' as const), token: fc.uuid({ version: 4 }) }),
      fc.record({ kind: fc.constant('garbage' as const), token: fc.string({ maxLength: 60 }) }),
      fc.record({ kind: fc.constant('absent' as const), token: fc.constant(null) })
    )
    const tokenState = fc.constantFrom('live', 'spent-or-unknown')

    await fc.assert(
      fc.asyncProperty(tokenShape, tokenState, async ({ kind, token }, state) => {
        hoisted.processUnsubscribeToken.mockReset()
        if (state === 'live') {
          hoisted.processUnsubscribeToken.mockResolvedValue({
            action: 'unsubscribe_all',
            principalId: 'principal_x',
            postId: null,
          })
        } else {
          hoisted.processUnsubscribeToken.mockResolvedValue(null)
        }

        const response = await oneClick(token)

        expect(response.status).toBe(200)
        expect(await response.text()).toBe('OK')
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
        // Only a well-formed token is ever looked up.
        const lookedUp = hoisted.processUnsubscribeToken.mock.calls.length > 0
        expect(lookedUp).toBe(kind === 'minted')
      })
    )
  })

  it('(U4) acts on a live token', async () => {
    const response = await oneClick(LIVE_TOKEN)

    expect(response.status).toBe(200)
    expect(hoisted.processUnsubscribeToken).toHaveBeenCalledTimes(1)
    expect(hoisted.processUnsubscribeToken).toHaveBeenCalledWith(LIVE_TOKEN)
  })

  it('(U4) records a processed opt-out at info, with what it did', async () => {
    await oneClick(LIVE_TOKEN)

    const lines = logged().map((r) => [r.level, r.component, r.msg, r.action])
    expect(lines).toEqual([
      ['info', 'one-click-unsubscribe', 'one-click unsubscribe processed', 'unsubscribe_all'],
    ])
  })

  it('(U4) records a spent or unknown token at debug only', async () => {
    hoisted.processUnsubscribeToken.mockResolvedValue(null)

    const response = await oneClick(LIVE_TOKEN)

    expect(response.status).toBe(200)
    const lines = logged().map((r) => [r.level, r.component, r.msg])
    expect(lines).toEqual([
      ['debug', 'one-click-unsubscribe', 'one-click unsubscribe token invalid or expired'],
    ])
  })

  it('(U4) accepts the one-click body whatever content type, or none, it is labelled with', async () => {
    // U4 makes the body the test of a one-click request; a label that is not
    // multipart does not turn the same bytes into something else.
    const body = new TextEncoder().encode(ONE_CLICK_BODY)
    const unlabelled = new Request(linkFor(LIVE_TOKEN), { method: 'POST', body })
    expect(unlabelled.headers.get('content-type')).toBeNull()
    const asText = new Request(linkFor(LIVE_TOKEN), {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body,
    })

    expect((await handleOneClickUnsubscribe(unlabelled)).status).toBe(200)
    expect((await handleOneClickUnsubscribe(asText)).status).toBe(200)
    expect(hoisted.processUnsubscribeToken).toHaveBeenCalledTimes(2)
  })

  it('(U4) is recognised as multipart form data too, whatever the header’s case', async () => {
    const form = new FormData()
    form.set('List-Unsubscribe', 'One-Click')
    const multipart = new Request(linkFor(LIVE_TOKEN), { method: 'POST', body: form })
    const contentType = multipart.headers.get('content-type') ?? ''
    const shouted = new Request(linkFor(LIVE_TOKEN), {
      method: 'POST',
      headers: {
        'content-type': contentType.replace('multipart/form-data', 'Multipart/Form-Data'),
      },
      body: await multipart.arrayBuffer(),
    })

    const response = await handleOneClickUnsubscribe(shouted)

    expect(response.status).toBe(200)
    expect(hoisted.processUnsubscribeToken).toHaveBeenCalledWith(LIVE_TOKEN)
  })

  it('(U4) reads a one-click body that arrives in several chunks', async () => {
    const encoded = new TextEncoder().encode(ONE_CLICK_BODY)
    const pieces = [encoded.slice(0, 5), encoded.slice(5, 17), encoded.slice(17)]
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const piece of pieces) controller.enqueue(piece)
        controller.close()
      },
    })

    const response = await handleOneClickUnsubscribe(streamedRequest(stream, FORM))

    expect(response.status).toBe(200)
    expect(hoisted.processUnsubscribeToken).toHaveBeenCalledWith(LIVE_TOKEN)
  })

  it('(U4) (U5) is not answered as a success when the opt-out itself fails, so it is retried', async () => {
    hoisted.processUnsubscribeToken.mockRejectedValue(new Error('connection terminated'))

    const response = await oneClick(LIVE_TOKEN)

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe('Try again later')
    const lines = logged().map((r) => [
      r.level,
      r.component,
      r.msg,
      (r.err as { message?: unknown } | undefined)?.message,
    ])
    expect(lines).toEqual([
      ['error', 'one-click-unsubscribe', 'one-click unsubscribe failed', 'connection terminated'],
    ])
  })
})

describe('a request without the one-click body', () => {
  it('(U4) is refused and acts on nothing, whatever else the form says', async () => {
    const otherField = fc
      .tuple(fc.string({ maxLength: 20 }), fc.string({ maxLength: 20 }))
      .filter(([name, value]) => !(name === 'List-Unsubscribe' && value === 'One-Click'))
    const notOneClick = fc.array(otherField, { maxLength: 4 })

    await fc.assert(
      fc.asyncProperty(notOneClick, async (fields) => {
        hoisted.processUnsubscribeToken.mockClear()
        const body = new URLSearchParams(fields).toString()

        const response = await oneClick(LIVE_TOKEN, { body })

        expect(response.status).toBe(400)
        expect(hoisted.processUnsubscribeToken).not.toHaveBeenCalled()
      })
    )
  })

  it('(U4) is refused when there is no body at all', async () => {
    const response = await handleOneClickUnsubscribe(
      new Request(linkFor(LIVE_TOKEN), { method: 'POST' })
    )

    expect(response.status).toBe(400)
    // What a provider's delivery log shows for the refusal.
    expect(await response.text()).toBe('Expected List-Unsubscribe=One-Click')
    expect(hoisted.processUnsubscribeToken).not.toHaveBeenCalled()
  })

  it('(U4) is refused when the field is sent with the wrong value', async () => {
    const response = await oneClick(LIVE_TOKEN, { body: 'List-Unsubscribe=one-click' })

    expect(response.status).toBe(400)
    expect(hoisted.processUnsubscribeToken).not.toHaveBeenCalled()
  })

  it('(U4) is refused when a multipart body carries the field with another value', async () => {
    const form = new FormData()
    form.set('List-Unsubscribe', 'Two-Clicks')

    const response = await handleOneClickUnsubscribe(
      new Request(linkFor(LIVE_TOKEN), { method: 'POST', body: form })
    )

    expect(response.status).toBe(400)
    expect(hoisted.processUnsubscribeToken).not.toHaveBeenCalled()
  })

  it('(U4) is refused when a multipart body cannot be parsed', async () => {
    const response = await oneClick(LIVE_TOKEN, {
      headers: { 'content-type': 'multipart/form-data' },
      body: ONE_CLICK_BODY,
    })

    expect(response.status).toBe(400)
    expect(hoisted.processUnsubscribeToken).not.toHaveBeenCalled()
  })
})

describe('the 1 KB cap', () => {
  it('(U4) a body of exactly 1 KB is still read', async () => {
    const body = oneClickBodyOfSize(ONE_KB)
    expect(new TextEncoder().encode(body).byteLength).toBe(ONE_KB)

    const response = await oneClick(LIVE_TOKEN, { body })

    expect(response.status).toBe(200)
    expect(hoisted.processUnsubscribeToken).toHaveBeenCalledTimes(1)
  })

  it('(U4) a body that declares exactly 1 KB is still read', async () => {
    const body = oneClickBodyOfSize(ONE_KB)

    const response = await oneClick(LIVE_TOKEN, {
      headers: { ...FORM, 'content-length': String(ONE_KB) },
      body,
    })

    expect(response.status).toBe(200)
    expect(hoisted.processUnsubscribeToken).toHaveBeenCalledTimes(1)
  })

  it('(U4) a body one byte over 1 KB is refused', async () => {
    const response = await oneClick(LIVE_TOKEN, { body: oneClickBodyOfSize(ONE_KB + 1) })

    expect(response.status).toBe(400)
    expect(hoisted.processUnsubscribeToken).not.toHaveBeenCalled()
  })

  it('(U4) a declared length over 1 KB is refused before the body is read at all', async () => {
    const { stream, counter } = endlessBody(100)
    const request = streamedRequest(stream, { ...FORM, 'content-length': String(ONE_KB + 1) })

    const response = await handleOneClickUnsubscribe(request)

    expect(response.status).toBe(400)
    expect(counter.pulled).toBe(0)
    expect(hoisted.processUnsubscribeToken).not.toHaveBeenCalled()
  })

  it('(U4) an endless chunked body is cut off at the cap, not buffered', async () => {
    const chunkBytes = 100
    const { stream, counter } = endlessBody(chunkBytes)

    const response = await handleOneClickUnsubscribe(streamedRequest(stream, FORM))

    expect(response.status).toBe(400)
    // A stream hands out whole chunks, so the reader can only stop on the
    // chunk that crosses the cap: the cap plus one chunk is the least any
    // reader could have taken, and the most this one may.
    expect(counter.pulled).toBeGreaterThan(ONE_KB)
    expect(counter.pulled).toBeLessThanOrEqual(ONE_KB + chunkBytes)
    expect(hoisted.processUnsubscribeToken).not.toHaveBeenCalled()
  })
})
