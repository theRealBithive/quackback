/**
 * ## S — Sign-in devices (upstream #525/#529)
 * - S3 The new-sign-in mail for an enforced-SSO recipient omits the password
 *   link and points at the identity provider.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock nodemailer so we can capture sendMail invocations without opening a real SMTP socket.
const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'test-msg-id' })
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({ sendMail: sendMailMock }),
  },
}))

import { sendNewSignInEmail } from '../index'
import { sealedTo } from './brands'

const ENV_KEYS = [
  'EMAIL_SMTP_HOST',
  'EMAIL_SMTP_PORT',
  'EMAIL_SMTP_USER',
  'EMAIL_SMTP_PASS',
  'EMAIL_SES_ACCESS_KEY_ID',
  'EMAIL_SES_SECRET_ACCESS_KEY',
  'EMAIL_FROM',
]

const SETTINGS_URL = 'https://acme.example/settings/profile'

describe('sendNewSignInEmail', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
    // Force SMTP provider so the helper renders + calls sendMail.
    process.env.EMAIL_SMTP_HOST = 'smtp.example.com'
    process.env.EMAIL_FROM = 'noreply@example.com'
    sendMailMock.mockClear()
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key]
      } else {
        delete process.env[key]
      }
    }
  })

  it('points an SSO-enforced recipient at their identity provider and omits the password link (S3)', async () => {
    const result = await sendNewSignInEmail({
      to: sealedTo('user@example.com'),
      workspaceName: 'Acme',
      occurredAt: '2026-09-14T12:00:00Z',
      settingsUrl: SETTINGS_URL,
      ssoEnforced: true,
    })

    expect(result).toEqual({ sent: true })
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const call = sendMailMock.mock.calls[0][0] as { html: string }
    expect(call.html).toMatch(/identity provider/i)
    expect(call.html).not.toContain(SETTINGS_URL)
    expect(call.html).not.toMatch(/set or change your password/i)
  })

  // Contrast case: proves the previous test's omissions are caused by
  // ssoEnforced, not merely by whichever fields happened to be passed.
  it('offers the password-settings link when SSO is not enforced', async () => {
    await sendNewSignInEmail({
      to: sealedTo('user@example.com'),
      workspaceName: 'Acme',
      occurredAt: '2026-09-14T12:00:00Z',
      settingsUrl: SETTINGS_URL,
      ssoEnforced: false,
    })

    const call = sendMailMock.mock.calls[0][0] as { html: string }
    expect(call.html).toContain(SETTINGS_URL)
    expect(call.html).not.toMatch(/identity provider/i)
  })
})
