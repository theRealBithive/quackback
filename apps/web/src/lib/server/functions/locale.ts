import { loadPortalMessages, type SupportedLocale } from '@/lib/shared/i18n'

/**
 * Load the portal's message catalogue for a locale the caller already knows.
 *
 * The locale is not resolved here, and deliberately so. The request bootstrap
 * resolves it once — from the signed-in teammate's own choice first, then the
 * `Accept-Language` header — and the SSR document's `<html lang>` is built from
 * that same value. A second resolver in the portal would agree with it only
 * for as long as nobody picks a language: the moment someone does, the header
 * still says French and the document says German, and the page declares a
 * language its text is not written in. One resolver, handed down through the
 * route context, is what keeps those two from drifting apart.
 *
 * `loadPortalMessages` runs wherever the loader runs: server-side during SSR,
 * and client-side (cached, code-split chunk) on client navigation. It returns
 * just the portal slice of the catalogue (see PORTAL_MESSAGE_PREFIXES), so the
 * SSR HTML does not carry the admin/inbox strings the portal never renders.
 */
export async function loadPortalIntl(locale: SupportedLocale): Promise<{
  locale: SupportedLocale
  messages: Record<string, string>
}> {
  return { locale, messages: await loadPortalMessages(locale) }
}
