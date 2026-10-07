/**
 * The client address Better Auth sees must be the one the rest of the app
 * trusts: the socket peer on a direct install, the trusted hop behind proxies,
 * and never a header the client wrote.
 *
 * The adapter is checked on its own, then once through a real Better Auth
 * instance configured the way the app configures it, so a library upgrade that
 * stops reading `ipAddressHeaders` (or starts reading something else first)
 * fails here.
 *
 * Contract (confirmed list for batch K, upstream #662):
 *
 *   C1 Sign-in attempts are counted per real client address, as the operator
 *      configured it: the connecting peer when no proxy is trusted, and the
 *      address the outermost trusted proxy saw otherwise, however many
 *      entries a client prepends.
 *   C2 A client cannot choose its own counting bucket, neither with forwarding
 *      headers nor by sending the internal client-address header itself.
 *   C3 Clients that send no forwarding headers are not lumped into one shared
 *      bucket, so one person's wrong passwords never lock out everyone else.
 *   C4 A new session records the same address the rate limiter counted.
 *   C5 When no address can be determined, nothing the client wrote is used in
 *      its place.
 *   C6 Anonymous votes are rate-limited by the same address.
 *   C7 Server-side calls into the sign-in library that pass request headers
 *      along get the same treatment as requests that reach it directly.
 *
 * Where the rest are held:
 *   C1, C2, C7  auth/__tests__/client-ip-wiring.test.ts (the real createAuth)
 *   C2          routes/api/auth/__tests__/registration-rate-limit-workspace.test.ts
 *   C6          functions/__tests__/anon-vote-client-ip.test.ts
 *   C7          functions/__tests__/contact-email-change.test.ts
 *               ('headers forwarded to Better Auth')
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { anonymous } from 'better-auth/plugins'
import fc from 'fast-check'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { proxyConfig, mockGetRequestIP } = vi.hoisted(() => ({
  proxyConfig: { hops: 0 },
  mockGetRequestIP: vi.fn(),
}))

vi.mock('@/lib/server/config', () => ({
  config: {
    get trustedProxyHops() {
      return proxyConfig.hops
    },
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestIP: mockGetRequestIP,
}))

import {
  CLIENT_IP_HEADER,
  betterAuthIpAddressOptions,
  sessionIpAddressOf,
  withTrustedClientIp,
  withTrustedClientIpArgs,
  withTrustedClientIpRequest,
} from '../client-ip'

beforeEach(() => {
  proxyConfig.hops = 0
  mockGetRequestIP.mockReset()
})

describe('withTrustedClientIp', () => {
  it('uses the socket peer and ignores a spoofed X-Forwarded-For when no proxy is trusted (C1, C2)', () => {
    mockGetRequestIP.mockReturnValue('203.0.113.7')
    const headers = withTrustedClientIp({ 'x-forwarded-for': '9.9.9.9' })
    expect(headers.get(CLIENT_IP_HEADER)).toBe('203.0.113.7')
  })

  it('uses the trusted hop when one proxy is trusted (C1)', () => {
    proxyConfig.hops = 1
    mockGetRequestIP.mockReturnValue('10.0.0.1')
    const headers = withTrustedClientIp({ 'x-forwarded-for': '9.9.9.9, 198.51.100.4' })
    expect(headers.get(CLIENT_IP_HEADER)).toBe('198.51.100.4')
  })

  it('overwrites a client-supplied copy of the private header (C2)', () => {
    mockGetRequestIP.mockReturnValue('203.0.113.7')
    const headers = withTrustedClientIp({ [CLIENT_IP_HEADER]: '9.9.9.9' })
    expect(headers.get(CLIENT_IP_HEADER)).toBe('203.0.113.7')
  })

  it('drops a client-supplied copy when no address can be resolved (C5)', () => {
    mockGetRequestIP.mockReturnValue(undefined)
    const headers = withTrustedClientIp({ [CLIENT_IP_HEADER]: '9.9.9.9' })
    expect(headers.has(CLIENT_IP_HEADER)).toBe(false)
  })

  it('leaves the caller headers untouched', () => {
    mockGetRequestIP.mockReturnValue('203.0.113.7')
    const original = new Headers({ [CLIENT_IP_HEADER]: '9.9.9.9' })
    withTrustedClientIp(original)
    expect(original.get(CLIENT_IP_HEADER)).toBe('9.9.9.9')
  })
})

describe('withTrustedClientIpRequest', () => {
  it('keeps method, url and body', async () => {
    mockGetRequestIP.mockReturnValue('203.0.113.7')
    const request = withTrustedClientIpRequest(
      new Request('https://acme.example/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' },
        body: JSON.stringify({ email: 'a@acme.example' }),
      })
    )
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://acme.example/api/auth/sign-in/email')
    expect(request.headers.get(CLIENT_IP_HEADER)).toBe('203.0.113.7')
    expect(await request.json()).toEqual({ email: 'a@acme.example' })
  })

  it('rebuilds a GET or HEAD without a body even when the adapter hands it one (C1)', async () => {
    // A request a sign-in attempt arrives on must always be rebuildable, or
    // it never reaches the counter. The platform refuses a GET or HEAD with a
    // body, so a server adapter that exposes a stream for one must not make
    // the rebuild throw.
    mockGetRequestIP.mockReturnValue('203.0.113.7')
    class AdapterRequest extends Request {
      get body(): ReadableStream<Uint8Array<ArrayBuffer>> {
        return new ReadableStream()
      }
    }

    for (const method of ['GET', 'HEAD']) {
      const rebuilt = withTrustedClientIpRequest(
        new AdapterRequest('https://acme.example/api/auth/get-session', { method })
      )
      expect(rebuilt.method).toBe(method)
      expect(rebuilt.body).toBeNull()
      expect(rebuilt.headers.get(CLIENT_IP_HEADER)).toBe('203.0.113.7')
    }
  })

  it('accepts the request object the Node dev server hands to route handlers', async () => {
    const { NodeRequest } = await loadSrvxNode()
    mockGetRequestIP.mockReturnValue('203.0.113.8')

    // A real HTTP round trip, so the input is exactly what the Node adapter
    // builds from an incoming message: a Request subclass the platform
    // constructor cannot copy from.
    const seen = await new Promise<{ ip: string | null; method: string; body: string }>(
      (resolve, reject) => {
        const server = createServer((req, res) => {
          const nodeRequest = new NodeRequest({ req, res }) as unknown as Request
          Promise.resolve()
            .then(async () => {
              const rebuilt = withTrustedClientIpRequest(nodeRequest)
              return {
                ip: rebuilt.headers.get(CLIENT_IP_HEADER),
                method: rebuilt.method,
                body: await rebuilt.text(),
              }
            })
            .then(resolve, reject)
            .finally(() => {
              res.end()
              server.close()
            })
        })
        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address() as AddressInfo
          fetch(`http://127.0.0.1:${port}/api/auth/sign-in/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', [CLIENT_IP_HEADER]: '9.9.9.9' },
            body: '{"email":"a@acme.example"}',
          }).catch(reject)
        })
      }
    )

    expect(seen).toEqual({
      ip: '203.0.113.8',
      method: 'POST',
      body: '{"email":"a@acme.example"}',
    })
  })
})

/**
 * The Node adapter TanStack Start's dev server wraps requests in. Not a direct
 * dependency, so it is resolved from the plugin that uses it.
 */
async function loadSrvxNode(): Promise<{
  NodeRequest: new (ctx: { req: IncomingMessage; res: ServerResponse }) => unknown
}> {
  const store = join(
    fileURLToPath(new URL('../../../../../../../', import.meta.url)),
    'node_modules/.bun'
  )
  const plugin = readdirSync(store).find((name) => name.startsWith('@tanstack+start-plugin-core@'))
  if (!plugin) throw new Error('@tanstack/start-plugin-core is not installed')
  const require = createRequire(
    join(store, plugin, 'node_modules/@tanstack/start-plugin-core/package.json')
  )
  return import(pathToFileURL(require.resolve('srvx/node')).href)
}

describe('withTrustedClientIpArgs', () => {
  it('rewrites the headers of a server-side api call (C7)', () => {
    mockGetRequestIP.mockReturnValue('203.0.113.7')
    const [arg] = withTrustedClientIpArgs([
      { headers: new Headers({ [CLIENT_IP_HEADER]: '9.9.9.9' }), body: { x: 1 } },
    ]) as [{ headers: Headers; body: unknown }]
    expect(arg.headers.get(CLIENT_IP_HEADER)).toBe('203.0.113.7')
    expect(arg.body).toEqual({ x: 1 })
  })

  it('passes calls without headers through (C7)', () => {
    const args = [{ body: { x: 1 } }]
    expect(withTrustedClientIpArgs(args)).toBe(args)
    expect(withTrustedClientIpArgs([])).toEqual([])
  })

  it('passes a first argument that is no call context through untouched (C7)', () => {
    // A function can carry a `headers` property, but it is not the options
    // object an api call forwards headers in.
    mockGetRequestIP.mockReturnValue('203.0.113.7')
    const notAContext = Object.assign(() => undefined, {
      headers: new Headers({ [CLIENT_IP_HEADER]: '9.9.9.9' }),
    })
    for (const first of [null, undefined, 'text', 0, notAContext]) {
      const args = [first, { body: { x: 1 } }]
      expect(withTrustedClientIpArgs(args)).toBe(args)
    }
  })
})

describe('through a real Better Auth instance', () => {
  const keys: string[] = []
  const counters = new Map<string, number>()
  const auth = betterAuth({
    baseURL: 'https://acme.example',
    secret: 'test-secret-not-used-for-anything-real',
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    emailAndPassword: { enabled: true },
    advanced: { ipAddress: betterAuthIpAddressOptions },
    rateLimit: {
      enabled: true,
      customStorage: {
        async consume(key: string, rule: { window: number; max: number }) {
          keys.push(key)
          const count = (counters.get(key) ?? 0) + 1
          counters.set(key, count)
          return count > rule.max
            ? { allowed: false, retryAfter: rule.window }
            : { allowed: true, retryAfter: null }
        },
      },
    },
  })

  function wrongPassword(peer: string, headers: Record<string, string> = {}) {
    mockGetRequestIP.mockReturnValue(peer)
    return auth.handler(
      withTrustedClientIpRequest(
        new Request('https://acme.example/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ email: 'nobody@acme.example', password: 'wrong-password' }),
        })
      )
    )
  }

  beforeEach(() => {
    keys.length = 0
    counters.clear()
  })

  it('buckets by the socket peer, not by a spoofed X-Forwarded-For (C1, C2)', async () => {
    await wrongPassword('203.0.113.21', { 'x-forwarded-for': '9.9.9.9' })
    expect(keys).toEqual(['203.0.113.21|/sign-in/email'])
  })

  it('ignores a client-supplied private header (C2)', async () => {
    await wrongPassword('203.0.113.22', { [CLIENT_IP_HEADER]: '9.9.9.9' })
    expect(keys).toEqual(['203.0.113.22|/sign-in/email'])
  })

  it('keeps one client locked out without locking out another, spoof or not (C2, C3)', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 4; i += 1) statuses.push((await wrongPassword('203.0.113.31')).status)
    expect(statuses.at(-1)).toBe(429)

    // The locked-out client cannot buy a fresh bucket with a forwarding header.
    expect((await wrongPassword('203.0.113.31', { 'x-forwarded-for': '9.9.9.9' })).status).toBe(429)
    // A different client is unaffected.
    expect((await wrongPassword('203.0.113.32')).status).not.toBe(429)
  })
})

// ---------------------------------------------------------------------------
// Properties over generated requests
// ---------------------------------------------------------------------------

/** A valid address of either family, as a socket or a proxy would report it. */
const ipAddress = fc.oneof(fc.ipV4(), fc.ipV6())

/**
 * Anything a client can put into one comma-separated forwarding entry: a real
 * address, a near miss, or junk. No comma, since a comma would only split it
 * into more client-written entries.
 */
const clientWrittenEntry = fc.oneof(
  ipAddress,
  fc.constantFrom('', ' ', 'unknown', '9.9.9.9 ', '::1', '127.0.0.1', '999.1.1.1'),
  fc.stringMatching(/^[a-z0-9.: _-]{0,15}$/)
)

/** A whole client-written header value: printable ASCII, commas allowed. */
const clientWrittenValue = fc.oneof(
  ipAddress,
  fc.array(clientWrittenEntry, { maxLength: 6 }).map((entries) => entries.join(', ')),
  fc.stringMatching(/^[\x21-\x7e]{0,40}$/)
)

/** The headers a client can write on a request it sends, any of them absent. */
const clientWrittenHeaders = fc.record(
  {
    'x-forwarded-for': clientWrittenValue,
    'x-real-ip': clientWrittenValue,
    'cf-connecting-ip': clientWrittenValue,
    [CLIENT_IP_HEADER]: clientWrittenValue,
  },
  { requiredKeys: [] }
)

describe('the address chosen for a request (C1, C2, C5)', () => {
  it('is the connecting peer when no proxy is trusted, whatever the client wrote (C1, C2)', () => {
    fc.assert(
      fc.property(ipAddress, clientWrittenHeaders, (peer, written) => {
        proxyConfig.hops = 0
        mockGetRequestIP.mockReturnValue(peer)

        const headers = withTrustedClientIp(written)

        expect(headers.get(CLIENT_IP_HEADER)).toBe(peer)
      }),
      { numRuns: 300 }
    )
  })

  it('is what the outermost trusted proxy saw, however many entries a client prepends (C1, C2)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }).chain((hops) =>
          fc.record({
            hops: fc.constant(hops),
            realClient: ipAddress,
            // Each trusted proxy behind the outermost one appends the address
            // of the proxy in front of it.
            innerProxies: fc.array(ipAddress, { minLength: hops - 1, maxLength: hops - 1 }),
            firstPrefix: fc.array(clientWrittenEntry, { maxLength: 10 }),
            secondPrefix: fc.array(clientWrittenEntry, { maxLength: 10 }),
            lastProxy: ipAddress,
            privateHeader: clientWrittenValue,
          })
        ),
        ({
          hops,
          realClient,
          innerProxies,
          firstPrefix,
          secondPrefix,
          lastProxy,
          privateHeader,
        }) => {
          proxyConfig.hops = hops
          mockGetRequestIP.mockReturnValue(lastProxy)
          const chosenWith = (prefix: string[]) =>
            withTrustedClientIp({
              'x-forwarded-for': [...prefix, realClient, ...innerProxies].join(', '),
              [CLIENT_IP_HEADER]: privateHeader,
            }).get(CLIENT_IP_HEADER)

          // Non-interference: what a client prepends never moves the address.
          expect(chosenWith(firstPrefix)).toBe(chosenWith(secondPrefix))
          expect(chosenWith(firstPrefix)).toBe(realClient)
        }
      ),
      { numRuns: 300 }
    )
  })

  it('carries no address at all when the peer is unknown, whatever the client wrote (C5)', () => {
    const unknownPeer = fc.oneof(
      fc.constant(undefined),
      fc.constant(''),
      fc.constant('not-an-address'),
      fc.constant('throws')
    )
    fc.assert(
      fc.property(unknownPeer, clientWrittenHeaders, (peer, written) => {
        proxyConfig.hops = 0
        if (peer === 'throws') {
          mockGetRequestIP.mockImplementation(() => {
            throw new Error('no request context')
          })
        } else {
          mockGetRequestIP.mockReturnValue(peer)
        }

        const headers = withTrustedClientIp(written)

        expect(headers.has(CLIENT_IP_HEADER)).toBe(false)
      }),
      { numRuns: 200 }
    )
  })

  it('carries no address behind proxies when the trusted position holds none (C5)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }).chain((hops) =>
          fc.record({
            hops: fc.constant(hops),
            forwarded: fc.oneof(
              fc.constant(null),
              fc.record({
                prefix: fc.array(clientWrittenEntry, { maxLength: 6 }),
                // A trusted proxy never writes this, so the position is unusable.
                atTrustedPosition: fc.constantFrom('unknown', 'garbage', '999.1.1.1', '1.2.3'),
                innerProxies: fc.array(ipAddress, { minLength: hops - 1, maxLength: hops - 1 }),
              })
            ),
            privateHeader: clientWrittenValue,
          })
        ),
        ({ hops, forwarded, privateHeader }) => {
          proxyConfig.hops = hops
          mockGetRequestIP.mockReturnValue('10.0.0.1')
          const written: Record<string, string> = { [CLIENT_IP_HEADER]: privateHeader }
          if (forwarded) {
            const { prefix, atTrustedPosition, innerProxies } = forwarded
            written['x-forwarded-for'] = [...prefix, atTrustedPosition, ...innerProxies].join(', ')
          }

          const headers = withTrustedClientIp(written)

          expect(headers.has(CLIENT_IP_HEADER)).toBe(false)
        }
      ),
      { numRuns: 200 }
    )
  })
})

describe('what a real Better Auth instance counts and records (C2, C3, C4, C5)', () => {
  /**
   * A fresh instance with the anonymous plugin, so a sign-in creates a session
   * without paying for a password hash. Built inside each test, never at
   * module scope.
   */
  function buildInstance() {
    const keys: string[] = []
    const tables = {
      user: [] as Record<string, unknown>[],
      session: [] as Record<string, unknown>[],
      account: [] as Record<string, unknown>[],
      verification: [] as Record<string, unknown>[],
    }
    const instance = betterAuth({
      baseURL: 'https://acme.example',
      secret: 'test-secret-not-used-for-anything-real',
      database: memoryAdapter(tables),
      plugins: [anonymous()],
      advanced: { ipAddress: betterAuthIpAddressOptions },
      rateLimit: {
        enabled: true,
        customStorage: {
          async consume(key: string) {
            keys.push(key)
            return { allowed: true, retryAfter: null }
          },
        },
      },
    })
    return { instance, keys, tables }
  }

  function anonymousSignIn(
    instance: ReturnType<typeof buildInstance>['instance'],
    headers: Record<string, string>
  ) {
    return instance.handler(
      withTrustedClientIpRequest(
        new Request('https://acme.example/api/auth/sign-in/anonymous', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: '{}',
        })
      )
    )
  }

  /** The address half of a `<address>|<path>` rate-limit key. */
  const addressOf = (key: string) => key.slice(0, key.lastIndexOf('|'))

  it('records on the new session the address it counted the attempt under (C4, C6)', async () => {
    // Includes the IPv4-mapped form a dual-stack socket reports for an IPv4 peer.
    const peer = fc.oneof(
      ipAddress,
      fc.ipV4().map((v4) => `::ffff:${v4}`)
    )
    await fc.assert(
      fc.asyncProperty(peer, clientWrittenHeaders, async (address, written) => {
        const { instance, keys, tables } = buildInstance()
        mockGetRequestIP.mockReturnValue(address)

        const response = await anonymousSignIn(instance, written)

        expect(response.status).toBe(200)
        expect(keys).toHaveLength(1)
        expect(tables.session).toHaveLength(1)
        expect(tables.session[0].ipAddress).toBe(addressOf(keys[0]))
        // The form the app hands the vote limiter (C6) is that same stored form.
        expect(sessionIpAddressOf(written)).toBe(tables.session[0].ipAddress)
      }),
      { numRuns: 40 }
    )
  })

  it('counts two header-less clients in two buckets (C3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.ipV4(), { minLength: 2, maxLength: 2 }),
        async ([first, second]) => {
          const { instance, keys } = buildInstance()

          mockGetRequestIP.mockReturnValue(first)
          await anonymousSignIn(instance, {})
          mockGetRequestIP.mockReturnValue(second)
          await anonymousSignIn(instance, {})

          expect(new Set(keys).size).toBe(2)
        }
      ),
      { numRuns: 30 }
    )
  })

  it('never counts or records a client-written address when the peer is unknown (C2, C5)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.ipV4().filter((ip) => ip !== '127.0.0.1'),
        async (spoofed) => {
          const { instance, keys, tables } = buildInstance()
          mockGetRequestIP.mockReturnValue(undefined)

          await anonymousSignIn(instance, {
            'x-forwarded-for': spoofed,
            'x-real-ip': spoofed,
            [CLIENT_IP_HEADER]: spoofed,
          })

          expect(keys.map(addressOf)).not.toContain(spoofed)
          expect(tables.session.map((row) => row.ipAddress)).not.toContain(spoofed)
        }
      ),
      { numRuns: 30 }
    )
  })
})
