/**
 * The audience stamped on a session as Better Auth creates it, and the retag
 * that rescues a portal visitor whose anonymous session was stamped for the
 * widget.
 *
 * Two surfaces mint anonymous sessions through the same `/sign-in/anonymous`
 * endpoint: the portal (cookie, same origin) and the widget (Bearer token via
 * `set-auth-token`, cookies omitted). The portal session has to reach
 * `requireAuth` as a portal session; the widget session has to stay widget so
 * its Bearer never satisfies a site surface. Absent a marker the mint is the
 * widget's, so an old or unmarked client lands on the restrictive side.
 *
 * Contract (confirmed list for batch K, upstream #644):
 *
 *   S1 An anonymous session minted by the portal is a portal session. One
 *      minted by the widget, or by any client that does not say, is a widget
 *      session.
 *   S2 Only the exact portal marker makes a portal session. Any other value
 *      counts as no marker.
 *   S3 The marker never affects a sign-in that is not anonymous.
 *   S4 Neither anonymous audience carries any team authority: no team role and
 *      no permissions, whichever audience it is.
 *   S5 A portal visitor whose anonymous session was tagged as a widget session
 *      is retagged as a portal session the next time they make a request,
 *      provided it arrives as the site's session cookie, without a bearer
 *      token, and belongs to an anonymous user.
 *   S6 An identified widget session, and any session presented as a bearer
 *      token, is never retagged.
 *   S7 If the retag cannot be written, the session stays as it was and the
 *      request goes on.
 *   S8 The portal's sign-in sends the marker. The widget's does not.
 *
 * Where the rest are held:
 *   S4, S5, S7  functions/__tests__/auth-scope.test.ts (through requireAuth)
 *   S5, S6      auth/__tests__/session-audience-heal.db.test.ts (real table)
 *   S8          lib/client/hooks/__tests__/use-ensure-anon-session.test.tsx and
 *               components/widget/__tests__/widget-auth-provider-audience.test.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

const hoisted = vi.hoisted(() => ({
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { update: hoisted.update },
}))

import {
  ANONYMOUS_SIGN_IN_PATH,
  assignSessionScope,
  healStrandedPortalSession,
  isStrandedPortalSession,
} from '../session-audience'
import { SESSION_AUDIENCE_HEADER } from '@/lib/shared/roles'

const base = { userId: 'user_anon', token: 'tok', expiresAt: new Date(0) }

function ctx(
  path: string,
  headers: Record<string, string> = {},
  via: 'headers' | 'request' = 'headers'
) {
  const bag = new Headers(headers)
  return via === 'headers' ? { path, headers: bag } : { path, request: { headers: bag } }
}

/**
 * A header bag that hands back exactly the marker value given. `Headers` would
 * trim surrounding whitespace and refuse control characters, which is the
 * transport's doing, not the rule's; the rule is read here on the raw value.
 */
function markerBag(marker: string | null) {
  return { get: (name: string) => (name === SESSION_AUDIENCE_HEADER ? marker : null) }
}

/** Marker values, weighted towards the near misses of the one that counts. */
const markerValue = fc.oneof(
  fc.constantFrom(
    'portal',
    'Portal',
    'PORTAL',
    ' portal',
    'portal ',
    'portal,portal',
    'portal, dashboard',
    'widget',
    'dashboard',
    ''
  ),
  fc.string()
)

describe('assignSessionScope', () => {
  it('tags the portal anonymous mint as portal (S1)', async () => {
    const result = await assignSessionScope(
      base,
      ctx('/sign-in/anonymous', { [SESSION_AUDIENCE_HEADER]: 'portal' })
    )
    expect(result).toEqual({ data: { ...base, scope: 'portal' } })
  })

  it('reads the marker from the request when the context carries no header bag (S1)', async () => {
    const result = await assignSessionScope(
      base,
      ctx('/sign-in/anonymous', { [SESSION_AUDIENCE_HEADER]: 'portal' }, 'request')
    )
    expect(result?.data.scope).toBe('portal')
  })

  it('tags the widget anonymous mint (no marker) as widget (S1)', async () => {
    const result = await assignSessionScope(base, ctx('/sign-in/anonymous'))
    expect(result).toEqual({ data: { ...base, scope: 'widget' } })
  })

  it('treats a mint with no context headers at all as widget (S1)', async () => {
    const result = await assignSessionScope(base, { path: '/sign-in/anonymous' })
    expect(result?.data.scope).toBe('widget')
  })

  it.each(['dashboard', 'widget', 'PORTAL', 'portal, dashboard', ''])(
    'never grants anything but portal or widget: marker %j mints widget (S2)',
    async (value) => {
      const result = await assignSessionScope(
        base,
        ctx('/sign-in/anonymous', { [SESSION_AUDIENCE_HEADER]: value })
      )
      expect(result?.data.scope).toBe('widget')
    }
  )

  it('makes a portal session from the exact marker and from nothing else (S1, S2)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.option(markerValue, { nil: null }), async (marker) => {
        const result = await assignSessionScope(base, {
          path: ANONYMOUS_SIGN_IN_PATH,
          headers: markerBag(marker),
        })

        const expected = marker === 'portal' ? 'portal' : 'widget'
        expect(result).toEqual({ data: { ...base, scope: expected } })
      }),
      { numRuns: 300 }
    )
  })

  it('leaves non-anonymous sign-ins at the column default, marker or not (S3)', async () => {
    for (const path of ['/sign-in/email', '/sign-in/social', '/callback/:id']) {
      expect(
        await assignSessionScope(base, ctx(path, { [SESSION_AUDIENCE_HEADER]: 'portal' }))
      ).toBeUndefined()
    }
    expect(await assignSessionScope(base, null)).toBeUndefined()
  })

  it('never lets the marker touch a sign-in on any other path (S3)', async () => {
    const otherPath = fc
      .oneof(
        fc.constantFrom('/sign-in/email', '/sign-in/anonymous/', '/SIGN-IN/ANONYMOUS', ''),
        fc.string()
      )
      .filter((path) => path !== ANONYMOUS_SIGN_IN_PATH)
    await fc.assert(
      fc.asyncProperty(otherPath, fc.option(markerValue, { nil: null }), async (path, marker) => {
        const result = await assignSessionScope(base, { path, headers: markerBag(marker) })

        expect(result).toBeUndefined()
      }),
      { numRuns: 300 }
    )
  })
})

// ---------------------------------------------------------------------------
// The retag of a stranded portal session
// ---------------------------------------------------------------------------

const scopeValue = fc.constantFrom<unknown>('widget', 'portal', 'dashboard', 'admin', null)
const isAnonymousValue = fc.constantFrom<unknown>(true, false, undefined, 'true', 1)
const authorizationValue = fc.constantFrom<string | null>(
  null,
  'Bearer tok',
  'bearer tok',
  'BEARER tok',
  'Basic dXNlcjpwYXNz',
  'Token tok',
  ''
)
const cookieValue = fc.constantFrom<string | null>(
  null,
  'better-auth.session_token=tok.sig',
  '__Secure-better-auth.session_token=tok.sig',
  'theme=dark; better-auth.session_token=tok.sig',
  'theme=dark;__Secure-better-auth.session_token=tok.sig',
  'other.better-auth.session_token=tok.sig',
  'better-auth.session_token_cache=tok',
  'theme=dark',
  ''
)

function presentedWith(authorization: string | null, cookie: string | null) {
  const values: Record<string, string> = {}
  if (authorization !== null) values.authorization = authorization
  if (cookie !== null) values.cookie = cookie
  return new Headers(values)
}

/** The cookie values above that carry the site's own session cookie. */
const SITE_COOKIES = new Set([
  'better-auth.session_token=tok.sig',
  '__Secure-better-auth.session_token=tok.sig',
  'theme=dark; better-auth.session_token=tok.sig',
  'theme=dark;__Secure-better-auth.session_token=tok.sig',
])

/** The contract's four conditions, written out from S5 and S6. */
function expectedStranded(
  scope: unknown,
  isAnonymous: unknown,
  authorization: string | null,
  cookie: string | null
): boolean {
  const widgetTagged = scope === 'widget'
  const anonymousUser = isAnonymous === true
  const presentedAsBearer = authorization !== null && /^bearer /i.test(authorization)
  const arrivedAsSiteCookie = cookie !== null && SITE_COOKIES.has(cookie)
  return widgetTagged && anonymousUser && !presentedAsBearer && arrivedAsSiteCookie
}

describe('isStrandedPortalSession (S5, S6)', () => {
  it('holds exactly for an anonymous widget session sent as the site cookie with no bearer', () => {
    fc.assert(
      fc.property(
        scopeValue,
        isAnonymousValue,
        authorizationValue,
        cookieValue,
        (scope, isAnonymous, authorization, cookie) => {
          const found = { session: { id: 'sess_1', scope }, user: { isAnonymous } }

          const stranded = isStrandedPortalSession(found, presentedWith(authorization, cookie))

          expect(stranded).toBe(expectedStranded(scope, isAnonymous, authorization, cookie))
        }
      ),
      { numRuns: 500 }
    )
  })
})

describe('healStrandedPortalSession (S5, S6, S7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.update.mockReturnValue({ set: hoisted.set })
    hoisted.set.mockReturnValue({ where: hoisted.where })
    hoisted.where.mockResolvedValue(undefined)
  })

  const stranded = () => ({
    session: { id: 'sess_1', scope: 'widget' as unknown, token: 'tok' },
    user: { id: 'user_1', isAnonymous: true },
  })
  const siteCookie = () => new Headers({ cookie: 'better-auth.session_token=tok.sig' })

  it('writes the portal scope and hands the session back as portal (S5)', async () => {
    const found = stranded()

    const healed = await healStrandedPortalSession(found, siteCookie())

    expect(hoisted.set).toHaveBeenCalledWith({ scope: 'portal' })
    expect(healed.session.scope).toBe('portal')
    // Everything but the scope is the session it was.
    expect(healed.session.id).toBe('sess_1')
    expect(healed.session.token).toBe('tok')
    expect(healed.user).toBe(found.user)
  })

  it('leaves the session exactly as it was when the write fails (S7)', async () => {
    hoisted.where.mockRejectedValue(new Error('connection terminated'))
    const found = stranded()

    const result = await healStrandedPortalSession(found, siteCookie())

    expect(result).toBe(found)
    expect(result.session.scope).toBe('widget')
  })

  it('writes nothing and returns the same session whenever it is not stranded (S5, S6)', async () => {
    await fc.assert(
      fc.asyncProperty(
        scopeValue,
        isAnonymousValue,
        authorizationValue,
        cookieValue,
        async (scope, isAnonymous, authorization, cookie) => {
          hoisted.update.mockClear()
          const found = { session: { id: 'sess_1', scope }, user: { isAnonymous } }
          const headers = presentedWith(authorization, cookie)

          const result = await healStrandedPortalSession(found, headers)

          // The conservation law across every case: the session comes back
          // retagged as portal exactly when it was stranded, and as itself
          // otherwise, with a write in the first case only.
          const wasStranded = expectedStranded(scope, isAnonymous, authorization, cookie)
          expect(result === found).toBe(!wasStranded)
          expect(hoisted.update).toHaveBeenCalledTimes(wasStranded ? 1 : 0)
          expect(result.session.scope).toBe(wasStranded ? 'portal' : scope)
        }
      ),
      { numRuns: 300 }
    )
  })
})
