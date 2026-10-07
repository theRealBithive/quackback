/**
 * "Require SSO" on a verified domain, in front of the email sign-in mint.
 *
 * `requestEmailSignin` mints its magic link through `mintMagicLinkUrl`, which
 * does not run the `hooks.before` chain, and the link is later redeemed at
 * `/magic-link/verify`, which carries its address inside the token where that
 * chain cannot read it. So the hard-binding rule every other email path gets
 * from the hook layer has to be decided here, before anything is minted.
 *
 * The mint is real and the Better-Auth instance it writes through is a
 * recorder, as in the sibling openSignup suite: every "minted nothing" claim
 * is paired with a control that mints, so an empty recorder is evidence.
 *
 * Contract (upstream #689), confirmed:
 *
 * E1 When an address's domain requires SSO, the person cannot sign in by email link or code either. The refusal depends only on the domain, never on whether an account exists.
 * E2 A person changes their email address only through the confirmed flow. The library's direct change endpoints cannot be reached over HTTP.
 * E3 An address at a domain that requires SSO cannot be taken by the person's own change or by an admin's edit. Renaming someone whose address stays the same still works.
 * E4 When an admin enters a new address, it is not treated as verified. An unchanged address keeps its verification.
 * E5 When a domain's enforcing provider signs someone in with an address at that domain, that sign-in verifies the account it lands on, so the account links instead of staying stuck. Whoever held an unlinked account before loses their sessions.
 * E6 An admin's edit that crosses with a concurrent change to the same address is refused, not silently overwritten.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

const hoisted = vi.hoisted(() => ({
  createVerificationValue: vi.fn(async (_row: { identifier: string; value: string }) => ({
    id: 'v_1',
  })),
  createVerificationOTP: vi.fn(async () => '123456'),
  sendMagicLinkEmail: vi.fn(async () => undefined),
  sendSignupNotAllowedEmail: vi.fn(async () => undefined),
  listIdentityProviders: vi.fn(),
  getRegisteredOidcProviderIds: vi.fn(),
  accountHolder: { id: 'user_1' } as { id: string } | null,
  invitation: null as { id: string } | null,
}))

vi.mock('../index', () => ({
  getAuth: vi.fn(async () => ({
    api: { createVerificationOTP: hoisted.createVerificationOTP },
    $context: { internalAdapter: { createVerificationValue: hoisted.createVerificationValue } },
  })),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      settings: { findFirst: vi.fn(async () => null) },
      // An existing account: the openSignup gate lets it through, so anything
      // that stops the mint below is the rule under test.
      user: { findFirst: vi.fn(async () => hoisted.accountHolder) },
      invitation: { findFirst: vi.fn(async () => hoisted.invitation) },
    },
  },
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: vi.fn(async () => ({ authConfig: { openSignup: true } })),
}))

vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: (...a: unknown[]) => hoisted.listIdentityProviders(...a),
}))

vi.mock('../registered-providers', () => ({
  getRegisteredOidcProviderIds: (...a: unknown[]) => hoisted.getRegisteredOidcProviderIds(...a),
}))

vi.mock('@quackback/email', () => ({
  isEmailConfigured: () => true,
  sendMagicLinkEmail: hoisted.sendMagicLinkEmail,
  sendSignupNotAllowedEmail: hoisted.sendSignupNotAllowedEmail,
}))

vi.mock('@/lib/server/storage/s3', () => ({ getEmailSafeUrl: () => null }))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://acme.quackback.io' } }))

import { requestEmailSignin, EmailSigninRefusedError } from '../email-signin'

function provider(domain: { name: string; enforced: boolean }) {
  return {
    id: 'idp_acme',
    registrationId: 'oidc_acme',
    showButton: true,
    domains: [{ name: domain.name, enforced: domain.enforced, verifiedAt: '2026-01-01T00:00:00Z' }],
  }
}

function mintedFor(): string[] {
  return hoisted.createVerificationValue.mock.calls.map(
    ([row]) => (JSON.parse(row.value) as { email: string }).email
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.accountHolder = { id: 'user_1' }
  hoisted.invitation = null
  hoisted.listIdentityProviders.mockResolvedValue([provider({ name: 'acme.com', enforced: true })])
  hoisted.getRegisteredOidcProviderIds.mockResolvedValue(new Set(['oidc_acme']))
})

describe('requestEmailSignin: Require SSO', () => {
  it('refuses an address at a domain that requires SSO, and mints nothing (E1)', async () => {
    const attempt = requestEmailSignin({ email: 'sam@acme.com', callbackURL: '/admin' })

    await expect(attempt).rejects.toBeInstanceOf(EmailSigninRefusedError)
    await expect(attempt).rejects.toMatchObject({ code: 'verified_domain_requires_sso' })
    expect(mintedFor()).toEqual([])
    expect(hoisted.createVerificationOTP).not.toHaveBeenCalled()
    expect(hoisted.sendMagicLinkEmail).not.toHaveBeenCalled()
  })

  it('mints for an address at another domain (E1)', async () => {
    await requestEmailSignin({ email: 'sam@example.com', callbackURL: '/' })

    expect(mintedFor()).toEqual(['sam@example.com'])
    expect(hoisted.sendMagicLinkEmail).toHaveBeenCalledTimes(1)
  })

  it('mints when the domain is verified but SSO is not required (E1)', async () => {
    hoisted.listIdentityProviders.mockResolvedValue([
      provider({ name: 'acme.com', enforced: false }),
    ])

    await requestEmailSignin({ email: 'sam@acme.com', callbackURL: '/' })

    expect(mintedFor()).toEqual(['sam@acme.com'])
  })

  // Same fail-open as every other path: an owning provider that cannot sign
  // anyone in right now (tier downgrade, missing secret) must not lock the
  // domain out of the workspace entirely.
  it('mints when the owning provider is not registered right now (no number: fail-open, beyond E1)', async () => {
    hoisted.getRegisteredOidcProviderIds.mockResolvedValue(new Set())

    await requestEmailSignin({ email: 'sam@acme.com', callbackURL: '/' })

    expect(mintedFor()).toEqual(['sam@acme.com'])
  })
})

// The refusal is a function of the domain alone. Reaches: any local part, the
// enforced domain in any letter case, an address that holds an account or
// not, and one an invitation names or not. Every combination must get the
// same error and mint nothing.
describe('requestEmailSignin: the refusal depends only on the domain (E1)', () => {
  const localPart = fc.stringMatching(/^[a-z0-9][a-z0-9._+-]{0,19}$/)
  const enforcedDomainSpelling = fc.constantFrom('acme.com', 'ACME.COM', 'Acme.Com', 'acme.COM')

  it('refuses every address at the enforced domain the same way, account or not', async () => {
    await fc.assert(
      fc.asyncProperty(
        localPart,
        enforcedDomainSpelling,
        fc.boolean(),
        fc.boolean(),
        async (local, domain, holdsAccount, invited) => {
          hoisted.createVerificationValue.mockClear()
          hoisted.sendMagicLinkEmail.mockClear()
          hoisted.accountHolder = holdsAccount ? { id: 'user_1' } : null
          hoisted.invitation = invited ? { id: 'inv_1' } : null

          const refusal = await requestEmailSignin({
            email: `${local}@${domain}`,
            callbackURL: '/',
          }).then(
            () => null,
            (error: unknown) => error
          )

          expect(refusal).toBeInstanceOf(EmailSigninRefusedError)
          expect(refusal).toMatchObject({ code: 'verified_domain_requires_sso' })
          expect(mintedFor()).toEqual([])
          expect(hoisted.sendMagicLinkEmail).not.toHaveBeenCalled()
        }
      ),
      { numRuns: 60 }
    )
  })

  // The control: the same local parts and account states at a subdomain of
  // the enforced domain, which the domain rule does not cover, are minted for.
  it('mints for the same addresses at a subdomain the rule does not cover', async () => {
    await fc.assert(
      fc.asyncProperty(localPart, async (local) => {
        hoisted.createVerificationValue.mockClear()
        hoisted.accountHolder = { id: 'user_1' }

        await requestEmailSignin({ email: `${local}@mail.acme.com`, callbackURL: '/' })

        expect(mintedFor()).toEqual([`${local}@mail.acme.com`])
      }),
      { numRuns: 30 }
    )
  })
})
