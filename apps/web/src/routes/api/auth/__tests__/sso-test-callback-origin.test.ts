/**
 * GET /api/auth/$ — the SSO test-callback interception branch.
 *
 * What an operator relies on: when a Test sign-in's OAuth callback lands
 * here, the popup's result page is rendered for the ORIGIN the admin's
 * opener tab actually lives at (read from `getBaseUrl()`), not necessarily
 * `request.url`'s origin — a TLS-terminating proxy can hand the app a plain
 * `http://` request URL even though the admin is on `https://`, and
 * `postMessage` to the wrong origin is silently rejected by the browser,
 * leaving the admin tab stuck on "waiting for test sign-in" until the
 * slower poll catches up.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

const hoisted = vi.hoisted(() => ({
  handleSsoTestCallback: vi.fn(),
  renderSsoTestCallbackHtml: vi.fn(),
  getBaseUrl: vi.fn(),
  authHandler: vi.fn(),
}))

vi.mock('@/lib/server/auth/sso-test-callback', () => ({
  handleSsoTestCallback: hoisted.handleSsoTestCallback,
  renderSsoTestCallbackHtml: hoisted.renderSsoTestCallbackHtml,
}))

vi.mock('@/lib/server/config', () => ({
  getBaseUrl: hoisted.getBaseUrl,
  config: { baseUrl: 'https://app.example.test' },
}))

vi.mock('@/lib/server/auth/index', () => ({
  auth: { handler: hoisted.authHandler },
}))

import { Route } from '../$'

type Handlers = {
  GET: (args: { request: Request }) => Promise<Response>
}

function handlers(): Handlers {
  return (Route as unknown as { options: { server: { handlers: Handlers } } }).options.server
    .handlers
}

const CALLBACK_URL = 'http://internal-proxy.local/api/auth/oauth2/callback/sso?state=abc&code=xyz'

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.renderSsoTestCallbackHtml.mockReturnValue(new Response('<html></html>', { status: 200 }))
})

describe('GET /api/auth/$ — SSO test callback origin (lines 62-63)', () => {
  it("renders the result page against getBaseUrl()'s origin, not the request URL's", async () => {
    hoisted.handleSsoTestCallback.mockResolvedValue({
      testId: 'test_1',
      result: { ok: true },
      identityMatched: true,
    })
    hoisted.getBaseUrl.mockReturnValue('https://app.example.test')

    await handlers().GET({ request: new Request(CALLBACK_URL) })

    expect(hoisted.getBaseUrl).toHaveBeenCalledTimes(1)
    expect(hoisted.renderSsoTestCallbackHtml).toHaveBeenCalledWith(
      expect.objectContaining({
        testId: 'test_1',
        origin: 'https://app.example.test',
        identityMatched: true,
      })
    )
  })

  it("falls back to the request URL's origin when getBaseUrl() has nothing configured", async () => {
    hoisted.handleSsoTestCallback.mockResolvedValue({
      testId: 'test_2',
      result: { ok: false },
      identityMatched: false,
    })
    hoisted.getBaseUrl.mockReturnValue(null)

    await handlers().GET({ request: new Request(CALLBACK_URL) })

    expect(hoisted.getBaseUrl).toHaveBeenCalledTimes(1)
    expect(hoisted.renderSsoTestCallbackHtml).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'http://internal-proxy.local' })
    )
  })

  it('falls through to the real auth handler when the callback path misses (not a test sign-in)', async () => {
    hoisted.handleSsoTestCallback.mockResolvedValue(null)
    hoisted.authHandler.mockResolvedValue(new Response('delegated', { status: 200 }))

    const response = await handlers().GET({ request: new Request(CALLBACK_URL) })

    expect(hoisted.getBaseUrl).not.toHaveBeenCalled()
    expect(hoisted.renderSsoTestCallbackHtml).not.toHaveBeenCalled()
    expect(hoisted.authHandler).toHaveBeenCalledTimes(1)
    expect(await response.text()).toBe('delegated')
  })
})
