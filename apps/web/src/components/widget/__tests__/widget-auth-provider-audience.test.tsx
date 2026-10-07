// @vitest-environment happy-dom
/**
 * The widget's lazy anonymous sign-in must stay unmarked: the server tags an
 * unmarked anonymous mint as a widget session, the audience whose Bearer never
 * satisfies a site surface.
 *
 * Contract (confirmed list for batch K, upstream #644; the full list is in
 * lib/server/auth/__tests__/session-audience.test.ts):
 *
 *   S8 The portal's sign-in sends the marker. The widget's does not.
 *
 * The portal half of S8 is held in
 * lib/client/hooks/__tests__/use-ensure-anon-session.test.tsx. Upstream pins
 * this half through the widget's file upload hook, which this fork does not
 * have; the mint itself lives in WidgetAuthProvider, so it is pinned there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installInMemoryLocalStorage } from '@/test/local-storage'
import { clearWidgetToken } from '@/lib/client/widget-auth'

installInMemoryLocalStorage()

vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))
vi.mock('@/lib/client/auth-client', () => ({
  authClient: {
    signIn: { anonymous: vi.fn().mockResolvedValue({ data: { token: 't' }, error: null }) },
  },
}))
vi.mock('@/lib/shared/i18n', async (orig) => ({
  ...(await orig<typeof import('@/lib/shared/i18n')>()),
  loadMessages: vi.fn().mockResolvedValue({}),
}))

import { WidgetAuthProvider, useWidgetAuth } from '../widget-auth-provider'
import { authClient } from '@/lib/client/auth-client'
import { SESSION_AUDIENCE_HEADER } from '@/lib/shared/roles'

const mintAnon = vi.mocked(authClient.signIn.anonymous)

let ensureSession: () => Promise<boolean> = async () => false

function Probe() {
  ensureSession = useWidgetAuth().ensureSession
  return null
}

function renderWidget() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <WidgetAuthProvider portalSessionToken={null}>
        <Probe />
      </WidgetAuthProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  clearWidgetToken()
  window.localStorage.clear()
  mintAnon.mockClear()
})

afterEach(cleanup)

describe('the widget anonymous mint (S8)', () => {
  it('mints without cookies and without claiming the portal audience (S8)', async () => {
    renderWidget()

    await act(async () => {
      await ensureSession()
    })

    expect(mintAnon).toHaveBeenCalledTimes(1)
    const [opts] = mintAnon.mock.calls[0] as unknown as [{ fetchOptions?: RequestInit } | undefined]
    expect(opts?.fetchOptions?.credentials).toBe('omit')
    expect(new Headers(opts?.fetchOptions?.headers).has(SESSION_AUDIENCE_HEADER)).toBe(false)
  })
})
