/**
 * The locale the product interface speaks to a signed-in teammate in.
 *
 * Exercises the real `bootstrap.ts` through mocked dependencies rather than a
 * re-implementation of its logic: a test that restates the production rule
 * agrees with it by construction and can never fail.
 *
 * Contract (domain language, confirmed before implementation):
 *
 *   V1 A signed-in teammate sees the admin interface in the language they
 *      picked in their own settings, on every admin page, already in the first
 *      paint the server sends.
 *   V2 A teammate who has picked no language sees the interface in the
 *      language their browser asks for, when we ship that language.
 *   V3 A teammate whose picked language we do not ship is not pinned to
 *      English for it: the interface falls back to the next signal, the
 *      language their browser asks for. Their inbox-translation language is
 *      unaffected either way -- the language a teammate reads customer
 *      messages in and the language the product speaks to them in are two
 *      separate choices.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  acceptLanguage: null as string | null,
  cookie: 'session=abc' as string | null,
  preferredLanguage: null as string | null,
  authenticated: true,
  sessionThrows: false,
}

function headersFor(): Headers {
  const h = new Headers()
  if (state.acceptLanguage !== null) h.set('accept-language', state.acceptLanguage)
  if (state.cookie !== null) h.set('cookie', state.cookie)
  return h
}

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: (fn: unknown) => fn,
  createServerFn: () => ({ handler: (fn: unknown) => fn }),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => headersFor(),
  setResponseHeader: () => undefined,
}))

vi.mock('@/lib/server/auth/index', () => ({
  auth: {
    api: {
      getSession: async () => {
        if (state.sessionThrows) throw new Error('auth unavailable')
        return state.authenticated
          ? {
              session: {
                id: 'session_1',
                expiresAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
              },
              user: {
                id: 'user_1',
                name: 'Jane',
                email: 'jane@example.com',
                emailVerified: true,
                image: null,
                createdAt: new Date(),
                updatedAt: new Date(),
                preferredLanguage: state.preferredLanguage,
              },
            }
          : null
      },
    },
  },
}))

vi.mock('@/lib/server/db', () => ({
  db: { query: { principal: { findFirst: async () => null } } },
  principal: {},
  eq: () => undefined,
}))

vi.mock('@/lib/server/cache', () => ({
  cacheGet: async () => ({ type: 'user', role: 'admin' }),
  cacheSet: async () => undefined,
  CACHE_KEYS: { PRINCIPAL_BY_USER: (id: string) => `principal:user:${id}` },
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: async () => null,
}))

vi.mock('@/lib/server/auth/registered-providers', () => ({
  getRegisteredAuthProviders: async () => [],
}))

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://example.test' },
}))

vi.mock('@/lib/server/domains/help-center/help-center-domain.service', () => ({
  resolveHelpCenterBaseUrl: () => 'https://example.test',
}))

vi.mock('@/lib/server/domains/settings/cloud/cloud.service', () => ({
  resolveCloudConfig: () => ({ enabled: false, canUpgrade: false, canManageBilling: false }),
}))

vi.mock('@/lib/server/process-role', () => ({ shouldRunWorkers: () => false }))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug() {}, info() {}, warn() {}, error() {} }) },
}))

vi.mock('@/lib/server/log-context', () => ({
  runWithoutLogContext: (fn: () => unknown) => fn(),
}))

async function resolveFor(options: {
  acceptLanguage: string | null
  preferredLanguage: string | null
  authenticated?: boolean
  /** Send a Cookie header even when the session behind it is gone or broken,
   *  so the resolution runs past the no-cookie fast path. */
  cookie?: string | null
  sessionThrows?: boolean
}) {
  state.acceptLanguage = options.acceptLanguage
  state.preferredLanguage = options.preferredLanguage
  state.authenticated = options.authenticated ?? true
  state.sessionThrows = options.sessionThrows ?? false
  state.cookie =
    options.cookie !== undefined ? options.cookie : state.authenticated ? 'session=abc' : null
  const { getBootstrapData } = await import('../bootstrap')
  const data = await (
    getBootstrapData as unknown as () => Promise<{ acceptLanguageLocale: string }>
  )()
  return data.acceptLanguageLocale
}

beforeEach(() => {
  vi.resetModules()
})

describe('the interface locale for a signed-in teammate', () => {
  it('uses the language the teammate picked, over the browser (V1)', async () => {
    expect(await resolveFor({ acceptLanguage: 'en', preferredLanguage: 'de' })).toBe('de')
  })

  it('uses the browser language when the teammate picked none (V2)', async () => {
    expect(await resolveFor({ acceptLanguage: 'fr-FR,fr;q=0.9', preferredLanguage: null })).toBe(
      'fr'
    )
  })

  it('falls back to the browser when the picked language is one we do not ship (V3)', async () => {
    expect(await resolveFor({ acceptLanguage: 'de', preferredLanguage: 'ja' })).toBe('de')
  })

  it('falls back to English when neither signal names a language we ship (V3)', async () => {
    expect(await resolveFor({ acceptLanguage: 'ja', preferredLanguage: 'ja' })).toBe('en')
  })

  it('uses the browser language for a visitor with no session at all (V2)', async () => {
    expect(
      await resolveFor({ acceptLanguage: 'ru', preferredLanguage: 'de', authenticated: false })
    ).toBe('ru')
  })

  it('uses the browser language when the cookie no longer names a session (V2)', async () => {
    // A stale or signed-out cookie gets past the no-cookie fast path but
    // yields no user, so there is no preference to read.
    expect(
      await resolveFor({
        acceptLanguage: 'de',
        preferredLanguage: 'fr',
        authenticated: false,
        cookie: 'session=stale',
      })
    ).toBe('de')
  })

  it('still answers with the browser language when the session lookup fails (V2)', async () => {
    // Auth can fail during SSR on a misconfigured environment. The document
    // still has to declare a language, and the header is the signal left.
    expect(
      await resolveFor({
        acceptLanguage: 'es',
        preferredLanguage: 'de',
        cookie: 'session=abc',
        sessionThrows: true,
      })
    ).toBe('es')
  })
})
