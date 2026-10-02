/**
 * Shared harness for the OIDC contract suites. It runs the sign-in library
 * itself (Better Auth with its in-memory adapter) over configs produced by
 * `buildGenericOAuthConfigs`, against a stubbed identity provider, so the
 * contract is checked against the code that really builds the authorization
 * request and really verifies the ID token. This file is not a test; the
 * suites that import it are `*.contract.test.ts`.
 */
import { vi } from 'vitest'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { genericOAuth } from 'better-auth/plugins'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { buildGenericOAuthConfigs } from '../build-oauth-configs'

export const ISSUER = 'https://idp.example'
export const CLIENT_ID = 'client-1'
export const BASE_URL = 'https://app.example'
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`

/** What the stubbed identity provider puts into the ID token it returns. */
export interface IdTokenSpec {
  /** Value for the nonce claim; undefined leaves the claim out. */
  nonce?: string
  issuer?: string
  audience?: string
  /** Sign with a key the identity provider does not publish. */
  signWithForeignKey?: boolean
}

export interface IdentityProviderStub {
  signIdToken: (spec: IdTokenSpec) => Promise<string>
  /** Decides the ID token for the next token-endpoint call. */
  tokenFor: (sentNonce: string | null) => IdTokenSpec
  jwks: unknown
}

export async function startIdentityProviderStub(): Promise<IdentityProviderStub> {
  const published = await generateKeyPair('RS256', { extractable: true })
  const foreign = await generateKeyPair('RS256', { extractable: true })
  const jwk = await exportJWK(published.publicKey)
  jwk.kid = 'key-1'
  jwk.alg = 'RS256'
  const jwks = { keys: [jwk] }

  const stub: IdentityProviderStub = {
    jwks,
    tokenFor: () => ({}),
    signIdToken: (spec) => {
      const claims: Record<string, unknown> = {
        email: 'you@example.com',
        email_verified: true,
        name: 'You',
      }
      if (spec.nonce !== undefined) claims.nonce = spec.nonce
      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
        .setIssuer(spec.issuer ?? ISSUER)
        .setAudience(spec.audience ?? CLIENT_ID)
        .setSubject('user-1')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(spec.signWithForeignKey ? foreign.privateKey : published.privateKey)
    },
  }
  return stub
}

/** The nonce carried by the most recent authorization request. */
let nonceOfLastAuthorizeRequest: string | null = null

export function installIdentityProviderFetch(stub: IdentityProviderStub) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url === DISCOVERY_URL) {
        return Response.json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/authorize`,
          token_endpoint: `${ISSUER}/token`,
          userinfo_endpoint: `${ISSUER}/userinfo`,
          jwks_uri: `${ISSUER}/jwks`,
          id_token_signing_alg_values_supported: ['RS256'],
        })
      }
      if (url === `${ISSUER}/jwks`) return Response.json(stub.jwks)
      if (url === `${ISSUER}/token`) {
        const spec = stub.tokenFor(nonceOfLastAuthorizeRequest)
        return Response.json({
          access_token: 'at',
          token_type: 'Bearer',
          id_token: await stub.signIdToken(spec),
        })
      }
      return new Response('not found', { status: 404 })
    })
  )
}

export function providerRow(overrides: Record<string, unknown>) {
  return {
    id: 'idp_1',
    registrationId: 'oidc_1',
    enabled: true,
    autoCreateUsers: true,
    clientId: CLIENT_ID,
    discoveryUrl: DISCOVERY_URL,
    ...overrides,
  }
}

export async function buildAuthFor(row: Record<string, unknown>, baseURL: string = BASE_URL) {
  const configs = await buildGenericOAuthConfigs({
    providers: [row] as never,
    creds: async () => ({ clientSecret: 'secret' }),
    tierAllowsOidc: true,
  })
  return betterAuth({
    baseURL,
    secret: 'contract-test-secret-not-used-for-anything-real',
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    plugins: [genericOAuth({ config: configs as never })],
  })
}

export interface SignInStart {
  authorizeUrl: URL
  cookieHeader: string
}

export async function startSignIn(
  auth: Awaited<ReturnType<typeof buildAuthFor>>,
  registrationId: string
): Promise<SignInStart> {
  const response = await auth.api.signInSocial({
    body: { provider: registrationId, callbackURL: '/' },
    asResponse: true,
  })
  const body = (await response.json()) as { url: string }
  const authorizeUrl = new URL(body.url)
  nonceOfLastAuthorizeRequest = authorizeUrl.searchParams.get('nonce')
  const cookieHeader = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
  return { authorizeUrl, cookieHeader }
}

export interface CallbackOutcome {
  /** True when the library issued a session cookie. */
  signedIn: boolean
  location: string | null
}

export async function returnToCallback(
  auth: Awaited<ReturnType<typeof buildAuthFor>>,
  start: SignInStart,
  callbackPath: string,
  rewrite: (request: Request) => Request = (request) => request
): Promise<CallbackOutcome> {
  const state = start.authorizeUrl.searchParams.get('state') ?? ''
  const url = `${BASE_URL}${callbackPath}?code=abc&state=${encodeURIComponent(state)}`
  const request = new Request(url, { headers: { cookie: start.cookieHeader } })
  const response = await auth.handler(rewrite(request))
  const cookies = response.headers.getSetCookie().join('\n')
  return {
    signedIn: cookies.includes('session_token'),
    location: response.headers.get('location'),
  }
}
