/**
 * The "prove you hold this address" email the confirmed change flow sends.
 *
 * Contract (upstream #689), confirmed:
 *
 * E1 When an address's domain requires SSO, the person cannot sign in by email link or code either. The refusal depends only on the domain, never on whether an account exists.
 * E2 A person changes their email address only through the confirmed flow. The library's direct change endpoints cannot be reached over HTTP.
 * E3 An address at a domain that requires SSO cannot be taken by the person's own change or by an admin's edit. Renaming someone whose address stays the same still works.
 * E4 When an admin enters a new address, it is not treated as verified. An unchanged address keeps its verification.
 * E5 When a domain's enforcing provider signs someone in with an address at that domain, that sign-in verifies the account it lands on, so the account links instead of staying stuck. Whoever held an unlinked account before loses their sessions.
 * E6 An admin's edit that crosses with a concurrent change to the same address is refused, not silently overwritten.
 *
 * Only E2 is held here: the confirmed flow is confirmed by a code, and this is
 * the one place that code leaves the server. Every other suite stubs it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  sendVerifyAddressEmail: vi.fn(async (_args: unknown) => {}),
  settingsRow: null as null | { name: string; logoKey: string | null },
}))

vi.mock('@quackback/email', () => ({
  sendVerifyAddressEmail: (args: unknown) => hoisted.sendVerifyAddressEmail(args),
}))
vi.mock('@/lib/server/storage/s3', () => ({
  getEmailSafeUrl: (key: string | null | undefined) =>
    key ? `https://cdn.example.test/${key}` : null,
}))
vi.mock('@/lib/server/db', () => ({
  db: { query: { settings: { findFirst: async () => hoisted.settingsRow } } },
}))

import { sendVerifyAddressCode } from '../verify-address-email'

beforeEach(() => {
  hoisted.sendVerifyAddressEmail.mockClear()
  hoisted.settingsRow = null
})

describe('sendVerifyAddressCode (E2)', () => {
  it('mails the code to the address, branded with the workspace', async () => {
    hoisted.settingsRow = { name: 'Acme', logoKey: 'logo.png' }

    await sendVerifyAddressCode('pat@example.com', '123456')

    expect(hoisted.sendVerifyAddressEmail).toHaveBeenCalledWith({
      to: 'pat@example.com',
      code: '123456',
      workspaceName: 'Acme',
      logoUrl: 'https://cdn.example.test/logo.png',
    })
  })

  it('still mails the code before the workspace has a name or a logo', async () => {
    await sendVerifyAddressCode('pat@example.com', '654321')

    expect(hoisted.sendVerifyAddressEmail).toHaveBeenCalledWith({
      to: 'pat@example.com',
      code: '654321',
      workspaceName: undefined,
      logoUrl: undefined,
    })
  })
})
