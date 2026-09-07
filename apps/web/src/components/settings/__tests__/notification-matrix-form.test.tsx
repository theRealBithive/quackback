// @vitest-environment happy-dom
/**
 * What the notification settings form renders under a second language.
 *
 * These hold the display side of this batch's notification guarantees; the
 * catalogue side is in `lib/shared/notifications/__tests__/catalog-ids.test.ts`.
 *
 * S6 Every notification a person can switch on or off is named and described
 *    in every shipped language, on both the admin and the portal settings
 *    surface. [V7, V16]
 * S8 The groups the settings page buckets notifications into are named in
 *    every language too. A translated list under an English heading is the
 *    failure this one prevents.
 *
 * Never English, because English proves nothing here: the `defaultMessage`
 * beside every id is the module's own English, so a form that never reads the
 * catalogue renders exactly the same page. German for the rows, French for the
 * tabs -- German keeps all three group names as they are, so it cannot witness
 * that the headings came from anywhere.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderInGerman, renderInLocale } from '@/test/render-with-intl'
import germanMessages from '@/locales/de.json'
import frenchMessages from '@/locales/fr.json'
import {
  NOTIFICATION_CATALOG,
  catalogForSurface,
  type NotificationGroup,
} from '@/lib/shared/notifications/catalog'
import {
  NOTIFICATION_GROUP_LABELS,
  notificationLabelId,
  notificationGroupId,
} from '@/lib/shared/notifications/message-ids'

const hoisted = vi.hoisted(() => ({ getPreferences: vi.fn(), updatePreferences: vi.fn() }))
vi.mock('@/lib/server/functions/user', () => ({
  getNotificationPreferencesFn: hoisted.getPreferences,
  updateNotificationPreferencesFn: hoisted.updatePreferences,
}))

import { NotificationMatrixForm } from '../notification-matrix-form'

const german = germanMessages as Record<string, string>
const french = frenchMessages as Record<string, string>

beforeEach(() => {
  vi.clearAllMocks()
  // Everything on: the rows render the same either way, and a preference
  // object built here rather than at module scope keeps a mutant that crashes
  // it from being reported as survived.
  hoisted.getPreferences.mockResolvedValue({ matrix: {}, emailMuted: false })
})

describe('the notification settings form in a second language (S6, S8)', () => {
  it('names every row it renders in the reader’s language (S6)', async () => {
    renderInGerman(<NotificationMatrixForm surface="admin" />)
    await waitFor(() => expect(hoisted.getPreferences).toHaveBeenCalled())

    // Only the first group's rows are mounted: the others sit behind tabs.
    const shown = catalogForSurface('admin').filter((meta) => meta.group === 'feedback')
    expect(shown.length).toBeGreaterThan(0)
    for (const meta of shown) {
      const name = german[notificationLabelId(meta.type)]
      expect(await screen.findByText(name)).toBeInTheDocument()
      expect(screen.queryByText(meta.label)).toBeNull()
    }
  })

  it('names every tab in the reader’s language (S8)', async () => {
    // French, not German: all three group names are loanwords German keeps as
    // they are, so a German tab strip reads the same whether the catalogue was
    // consulted or not. The check below says so rather than assuming it.
    renderInLocale('fr', <NotificationMatrixForm surface="admin" />)
    await waitFor(() => expect(hoisted.getPreferences).toHaveBeenCalled())

    const groups = [...new Set(NOTIFICATION_CATALOG.map((meta) => meta.group))]
    for (const group of groups) {
      const heading = french[notificationGroupId(group)]
      expect(await screen.findByRole('tab', { name: heading })).toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: NOTIFICATION_GROUP_LABELS[group] })).toBeNull()
    }
  })

  it('has group headings French moves and German does not, which is why the test above is French (S8)', () => {
    const moves = (locale: Record<string, string>) =>
      (Object.keys(NOTIFICATION_GROUP_LABELS) as NotificationGroup[]).filter(
        (group) => locale[notificationGroupId(group)] !== NOTIFICATION_GROUP_LABELS[group]
      )

    expect(moves(french)).toHaveLength(3)
    expect(moves(german)).toHaveLength(0)
  })

  it('translates the chrome around the rows (S6)', async () => {
    renderInGerman(<NotificationMatrixForm surface="portal" />)
    await waitFor(() => expect(hoisted.getPreferences).toHaveBeenCalled())

    expect(
      await screen.findByText(german['notificationSettings.pauseEmail.title'])
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText(german['notificationSettings.pauseEmail.toggle'])
    ).toBeInTheDocument()
    expect(screen.getByText(german['notificationSettings.channel.inApp'])).toBeInTheDocument()
  })

  it('says so in the reader’s language when the preferences will not load (S6)', async () => {
    // Rejected with something that is not an `Error`, which is the branch that
    // has a sentence of its own rather than one the server wrote.
    hoisted.getPreferences.mockRejectedValue('no message')
    renderInGerman(<NotificationMatrixForm surface="admin" />)

    expect(await screen.findByText(german['notificationSettings.error.load'])).toBeInTheDocument()
  })

  it('says so in the reader’s language when a switch will not save (S6)', async () => {
    hoisted.updatePreferences.mockRejectedValue('no message')
    renderInGerman(<NotificationMatrixForm surface="admin" />)
    await waitFor(() => expect(hoisted.getPreferences).toHaveBeenCalled())

    fireEvent.click(screen.getByLabelText(german['notificationSettings.pauseEmail.toggle']))

    expect(await screen.findByText(german['notificationSettings.error.save'])).toBeInTheDocument()
  })

  it('says so in the reader’s language when a row will not save (S6)', async () => {
    hoisted.updatePreferences.mockRejectedValue('no message')
    renderInGerman(<NotificationMatrixForm surface="admin" />)
    await waitFor(() => expect(hoisted.getPreferences).toHaveBeenCalled())

    const first = catalogForSurface('admin').filter((meta) => meta.group === 'feedback')[0]
    const name = german[notificationLabelId(first.type)]
    fireEvent.click(
      screen.getByLabelText(`${name} - ${german['notificationSettings.channel.inApp']}`)
    )

    expect(await screen.findByText(german['notificationSettings.error.save'])).toBeInTheDocument()
  })
})
