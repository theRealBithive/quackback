/**
 * Every notification sender that puts an unsubscribe link in its email puts
 * the same link in the List-Unsubscribe headers, offline on the SES rung.
 *
 * Contract (upstream #687), verbatim:
 *
 *   U1 Opening an unsubscribe link never unsubscribes anyone. It shows what would happen and asks for confirmation.
 *   U2 The unsubscribe happens only on an explicit confirmation, or on a one-click request from the mail provider.
 *   U3 A malformed, unknown, used or expired token shows the expired-link page, never a server error.
 *   U4 A one-click request in the RFC 8058 form is answered with success for every token, whether live, used, unknown or malformed. A request without the one-click body is refused. A body larger than 1 KB is refused without reading more than the chunk that crosses 1 KB.
 *   U5 A token is spent only once the opt-out has actually happened. If the opt-out fails, the link keeps working and a retry succeeds exactly once.
 *   U6 Unsubscribing from the changelog also stops the changelog mail that reaches a person through posts they follow, even if they never subscribed to the changelog.
 *   U7 Every notification email that has a tokenised unsubscribe link carries List-Unsubscribe. It offers one-click only when the link is HTTPS. An email without such a link carries neither header; a link to the notification preferences is not an unsubscribe link.
 *   U8 The unsubscribe page is in the language the rest of the site resolved for the request, in all nine languages, and the German addresses the reader formally.
 *   U9 The unsubscribe page's strings are not loaded into the portal or the widget.
 *
 * This module holds U7 for the senders: each of the seven that takes an
 * unsubscribe link attaches the headers built from that link, and none when
 * it has none. The header builder itself is in list-unsubscribe.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SendEmailCommand, SendEmailCommandOutput } from '@aws-sdk/client-sesv2'
import {
  sendChangelogPublishedEmail,
  sendFeedbackLinkedEmail,
  sendNewCommentEmail,
  sendPostMentionEmail,
  sendStatusChangeEmail,
  sendStatusIncidentPublishedEmail,
  sendStatusMaintenanceScheduledEmail,
  sendNoteMentionEmail,
  sendTicketEventEmail,
} from '../index'

const sdkSend = vi.hoisted(() => vi.fn())

vi.mock('@quackback/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@quackback/logger')>()
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => logger,
  }
  return { ...actual, createLogger: () => logger }
})

vi.mock('@aws-sdk/client-sesv2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-sesv2')>()
  return {
    ...actual,
    SESv2Client: class {
      send = sdkSend
    },
  }
})

const ENV = {
  EMAIL_SES_ACCESS_KEY_ID: 'AKIAEXAMPLE',
  EMAIL_SES_SECRET_ACCESS_KEY: 'secret',
  EMAIL_SES_REGION: 'us-east-1',
  EMAIL_FROM: 'notifications@platform.test',
  EMAIL_SMTP_HOST: undefined,
  EMAIL_SES_CONFIGURATION_SET: undefined,
  EMAIL_RESEND_API_KEY: undefined,
  RESEND_API_KEY: undefined,
}

const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) {
    savedEnv[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  sdkSend.mockReset()
  sdkSend.mockResolvedValue({
    MessageId: 'ses-assigned-1',
    $metadata: { httpStatusCode: 200 },
  } as SendEmailCommandOutput)
})

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

const TO = 'customer@example.test'
const POST_URL = 'https://acme.test/b/ideas/posts/1'
const INCIDENT_URL = 'https://acme.test/status/incidents/1'

/**
 * The seven senders, each called with the smallest valid input and the link
 * under test. "No link" is the empty string, the one value every sender's
 * type accepts, since six of the seven require the field.
 */
const SENDERS: Array<[string, (unsubscribeUrl: string) => Promise<unknown>]> = [
  [
    'status change',
    (unsubscribeUrl) =>
      sendStatusChangeEmail({
        to: TO,
        postTitle: 'Dark mode',
        postUrl: POST_URL,
        previousStatus: 'open',
        newStatus: 'planned',
        workspaceName: 'Acme',
        unsubscribeUrl,
      }),
  ],
  [
    'new comment',
    (unsubscribeUrl) =>
      sendNewCommentEmail({
        to: TO,
        postTitle: 'Dark mode',
        postUrl: POST_URL,
        commenterName: 'Ada',
        commentPreview: 'Shipped!',
        isTeamMember: true,
        workspaceName: 'Acme',
        unsubscribeUrl,
      }),
  ],
  [
    'post mention',
    (unsubscribeUrl) =>
      sendPostMentionEmail({
        to: TO,
        mentionerName: 'Ada',
        postTitle: 'Dark mode',
        excerpt: '',
        postUrl: POST_URL,
        workspaceName: 'Acme',
        unsubscribeUrl,
      }),
  ],
  [
    'changelog published',
    (unsubscribeUrl) =>
      sendChangelogPublishedEmail({
        to: TO,
        changelogTitle: 'May release',
        changelogUrl: 'https://acme.test/changelog/1',
        contentPreview: 'New things',
        workspaceName: 'Acme',
        unsubscribeUrl,
      }),
  ],
  [
    'feedback linked',
    (unsubscribeUrl) =>
      sendFeedbackLinkedEmail({
        to: TO,
        postTitle: 'Dark mode',
        postUrl: POST_URL,
        workspaceName: 'Acme',
        unsubscribeUrl,
      }),
  ],
  [
    'status incident published',
    (unsubscribeUrl) =>
      sendStatusIncidentPublishedEmail({
        to: TO,
        workspaceName: 'Acme',
        incidentTitle: 'API outage',
        impact: 'major',
        statusLabel: 'Investigating',
        body: 'We are looking into it.',
        affectedComponents: [{ name: 'API', status: 'major_outage' }],
        incidentUrl: INCIDENT_URL,
        unsubscribeUrl,
      }),
  ],
  [
    'status maintenance scheduled',
    (unsubscribeUrl) =>
      sendStatusMaintenanceScheduledEmail({
        to: TO,
        workspaceName: 'Acme',
        maintenanceTitle: 'Database upgrade',
        body: 'Short downtime.',
        startLabel: 'Mon 10:00',
        endLabel: 'Mon 11:00',
        affectedComponents: ['API'],
        incidentUrl: INCIDENT_URL,
        unsubscribeUrl,
      }),
  ],
]

function sentHeaders() {
  expect(sdkSend).toHaveBeenCalledTimes(1)
  const command = sdkSend.mock.calls[0][0] as SendEmailCommand
  return command.input.Content?.Simple?.Headers
}

describe.each(SENDERS)('the %s email', (_name, send) => {
  it('(U7) carries its own https link as List-Unsubscribe with the one-click offer', async () => {
    await send('https://acme.test/unsubscribe?token=tok-https')

    expect(sentHeaders()).toEqual([
      { Name: 'List-Unsubscribe', Value: '<https://acme.test/unsubscribe?token=tok-https>' },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ])
  })

  it('(U7) carries a plain http link without the one-click offer', async () => {
    await send('http://localhost:3000/unsubscribe?token=tok-dev')

    expect(sentHeaders()).toEqual([
      { Name: 'List-Unsubscribe', Value: '<http://localhost:3000/unsubscribe?token=tok-dev>' },
    ])
  })

  it('(U7) carries neither header when it has no link', async () => {
    await send('')

    expect(sentHeaders()).toBeUndefined()
  })
})

// A footer link to the notification preferences opens a page whose POST does
// not unsubscribe, so advertising it as one-click would be a false promise.
describe('emails whose footer links only to the notification preferences', () => {
  const PREFERENCES_URL = 'https://acme.test/settings/notifications'

  it('(U7) a note mention carries no List-Unsubscribe', async () => {
    await sendNoteMentionEmail({
      to: TO,
      authorName: 'Ada',
      preview: 'See this',
      conversationUrl: 'https://acme.test/admin/inbox/1',
      workspaceName: 'Acme',
      preferencesUrl: PREFERENCES_URL,
    })

    expect(sentHeaders()).toBeUndefined()
  })

  it('(U7) a ticket event carries no List-Unsubscribe', async () => {
    await sendTicketEventEmail({
      to: TO,
      kind: 'created',
      ticketLabel: '#142',
      title: 'Printer on fire',
      workspaceName: 'Acme',
      ctaUrl: 'https://acme.test/tickets/142',
      preferencesUrl: PREFERENCES_URL,
    })

    expect(sentHeaders()).toBeUndefined()
  })
})
