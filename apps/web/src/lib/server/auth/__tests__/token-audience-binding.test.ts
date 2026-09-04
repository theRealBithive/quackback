/**
 * Which resources a token this instance mints can be valid for.
 *
 * S1 A token this instance mints is only ever valid for a resource the user's
 *    authorization actually covered.
 *
 * That guarantee is not held by the OAuth provider we run. GHSA-p2fr-6hmx-4528
 * (`@better-auth/oauth-provider` >= 1.4.8 < 1.7.0-beta.4, and we are on 1.6.30):
 * the provider accepts `resource` only at the token endpoint, never records it on
 * the authorization code, and re-derives the audience from the refresh request
 * body. A client that completes a normal flow can therefore ask for a token whose
 * audience points at a resource server the authorization never covered — as long
 * as that audience is in `validAudiences`.
 *
 * S1 holds here for one reason only: `validAudiences` has exactly one entry, so
 * there is no other audience to escalate to. The one entry is the MCP endpoint,
 * and `mcp/handler.ts` verifies exactly that audience. A second entry re-opens
 * the advisory in full, in a package version that has no fix — and it would look
 * like a one-line feature addition in a diff.
 *
 * So this test is the guard, not a behaviour test: it fails when the array grows.
 * The three ways out, in order of preference:
 *
 *   1. Move to a patched release (>= 1.7.0 final, once it exists — Renovate's
 *      `config:recommended` ignores prereleases, so it will not offer the beta),
 *      confirm the provider binds resources to the grant, and delete this test
 *      naming the version that made it unnecessary.
 *   2. Keep one audience.
 *   3. Neither — then say in the commit why an unbound audience is acceptable
 *      here, because the advisory says it is not.
 *
 * Read from source rather than by importing the config: the audience list is a
 * template literal inside a plugin call in a module that pulls in the database
 * and the settings cache, and a guard that needs a live instance to run is a
 * guard that gets skipped.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const authConfig = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.ts')

/** The entries of the `validAudiences` array literal, as written. */
function configuredAudiences(): string[] {
  const source = readFileSync(authConfig, 'utf8')
  const matches = [...source.matchAll(/validAudiences:\s*\[([^\]]*)\]/g)]

  // More than one site configuring audiences is itself the finding: this guard
  // would only be watching one of them.
  expect(matches).toHaveLength(1)

  return matches[0][1]
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

describe('the audiences a token can be minted for (S1)', () => {
  it('is exactly one, because the provider does not bind resources to the grant', () => {
    expect(configuredAudiences()).toHaveLength(1)
  })

  it('is the MCP endpoint the resource server actually checks for', () => {
    // If these two drift apart, every token is rejected — a loud failure, but
    // this says which line to look at.
    const [audience] = configuredAudiences()
    expect(audience).toContain('/api/mcp')

    const handler = readFileSync(
      path.resolve(path.dirname(authConfig), '..', 'mcp', 'handler.ts'),
      'utf8'
    )
    expect(handler).toMatch(/audience:\s*`\$\{config\.baseUrl\}\/api\/mcp`/)
  })
})
