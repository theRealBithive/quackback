/**
 * The runtime-error-log tests drive the wrapper directly, so they stay green
 * even if nothing in production ever installs it. This pins that the server
 * entry does.
 *
 * Contract (confirmed list for batch K, upstream #688; the full list is in
 * lib/server/__tests__/runtime-error-log.test.ts):
 *
 *   L3 A failure already logged at the request boundary is not printed a
 *      second time by the runtime.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  installRuntimeErrorLog: vi.fn(),
  assertBootConfigurationOrExit: vi.fn(),
  logStartupBanner: vi.fn(),
}))

vi.mock('@tanstack/react-start/server-entry', () => ({
  default: { fetch: vi.fn() },
  createServerEntry: (entry: unknown) => entry,
}))
vi.mock('@/lib/server/boot-config', () => ({
  assertBootConfigurationOrExit: hoisted.assertBootConfigurationOrExit,
}))
vi.mock('@/lib/server/startup', () => ({ logStartupBanner: hoisted.logStartupBanner }))
vi.mock('@/lib/server/runtime-error-log', () => ({
  installRuntimeErrorLog: hoisted.installRuntimeErrorLog,
}))

afterEach(() => vi.unstubAllEnvs())

describe('the server entry', () => {
  it('routes the runtime error print through the structured log (L3)', async () => {
    // Skips the connection warmup, which would dial a real database.
    vi.stubEnv('QUACKBACK_BUILD', '1')

    await import('../server')

    expect(hoisted.installRuntimeErrorLog).toHaveBeenCalledTimes(1)
    expect(hoisted.installRuntimeErrorLog).toHaveBeenCalledWith()
  })
})
