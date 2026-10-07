// @vitest-environment node
/**
 * The /unsubscribe page seeds only the `unsubscribe.` slice of the catalog
 * (loadUnsubscribeMessages), so an id it renders outside that prefix, or one
 * missing from the catalog, would show its English fallback in every locale.
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
 * This module holds U8 (every id the page renders reaches the reader in their
 * language) and U9.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  SUPPORTED_LOCALES,
  UNSUBSCRIBE_MESSAGE_PREFIX,
  isUnsubscribeMessage,
  loadPortalMessages,
  loadUnsubscribeMessages,
  loadWidgetMessages,
  type SupportedLocale,
} from '@/lib/shared/i18n'
import en from '@/locales/en.json'
import de from '@/locales/de.json'

const PAGE = fileURLToPath(new URL('../../../routes/unsubscribe.tsx', import.meta.url))

function messageIds(source: string): string[] {
  const ids = new Set<string>()
  for (const m of source.matchAll(/\bid\s*:\s*['"]([^'"]+)['"]/g)) ids.add(m[1])
  for (const m of source.matchAll(/\bid=["']([^"']+)["']/g)) ids.add(m[1])
  return [...ids].filter((id) => id.includes('.'))
}

describe('unsubscribe page message-id coverage', () => {
  it('(U8) renders only seeded, catalogued ids', () => {
    const ids = messageIds(readFileSync(PAGE, 'utf8'))
    expect(ids.length).toBeGreaterThan(20)

    expect(ids.filter((id) => !id.startsWith(UNSUBSCRIBE_MESSAGE_PREFIX))).toEqual([])
    const catalog = en as Record<string, string>
    expect(ids.filter((id) => !(id in catalog))).toEqual([])
  })
})

async function catalogueOf(locale: SupportedLocale): Promise<Record<string, string>> {
  const module = await import(`@/locales/${locale}.json`)
  return module.default as Record<string, string>
}

function unsubscribeKeys(messages: Record<string, string>): string[] {
  return Object.keys(messages).filter((key) => key.startsWith(UNSUBSCRIBE_MESSAGE_PREFIX))
}

describe('where the unsubscribe strings are loaded', () => {
  it('(U9) the catalogue does hold unsubscribe strings, so their absence below means something', () => {
    expect(unsubscribeKeys(en as Record<string, string>).length).toBeGreaterThan(20)
  })

  it.each(SUPPORTED_LOCALES.map((locale) => [locale]))(
    '(U9) neither the portal nor the widget slice carries them in %s',
    async (locale: SupportedLocale) => {
      const portal = await loadPortalMessages(locale)
      const widget = await loadWidgetMessages(locale)

      expect(unsubscribeKeys(portal)).toEqual([])
      expect(unsubscribeKeys(widget)).toEqual([])
      // The slices are not empty: an empty one would pass the line above.
      expect(Object.keys(portal).length).toBeGreaterThan(100)
      expect(Object.keys(widget).length).toBeGreaterThan(50)
    }
  )

  it.each(SUPPORTED_LOCALES.map((locale) => [locale]))(
    '(U8) (U9) the page’s own slice in %s is every unsubscribe string of that catalogue and nothing else',
    async (locale: SupportedLocale) => {
      const catalogue = await catalogueOf(locale)
      const slice = await loadUnsubscribeMessages(locale)

      const expected: Record<string, string> = {}
      for (const key of unsubscribeKeys(catalogue)) expected[key] = catalogue[key]
      expect(slice).toEqual(expected)
      expect(Object.keys(slice).sort()).toEqual(
        unsubscribeKeys(en as Record<string, string>).sort()
      )
    }
  )

  it('(U8) the German slice is the German text, not the English', async () => {
    const slice = await loadUnsubscribeMessages('de')

    expect(slice['unsubscribe.confirm.button']).toBe(
      (de as Record<string, string>)['unsubscribe.confirm.button']
    )
    expect(slice['unsubscribe.confirm.button']).not.toBe(
      (en as Record<string, string>)['unsubscribe.confirm.button']
    )
  })

  it('(U9) only a key under the unsubscribe namespace counts as the page’s own', () => {
    expect(isUnsubscribeMessage('unsubscribe.confirm.button')).toBe(true)
    expect(isUnsubscribeMessage('portal.unsubscribe.confirm.button')).toBe(false)
    expect(isUnsubscribeMessage('unsubscribeLater')).toBe(false)
  })
})

describe('the German unsubscribe strings', () => {
  it('(U8) address the reader formally', () => {
    const informal =
      /(?<![\p{L}])(du|dich|dir|dein|deine|deinen|deinem|deiner|deines|euch|euer|eure)(?![\p{L}])/iu
    const german = de as Record<string, string>
    const offenders = unsubscribeKeys(german).filter((key) => informal.test(german[key]))

    expect(offenders).toEqual([])
    expect(german['unsubscribe.error.missing.message']).toMatch(/\bverwenden Sie\b/)
  })
})
