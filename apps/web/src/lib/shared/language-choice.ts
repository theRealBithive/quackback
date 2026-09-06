import { SUPPORTED_LOCALES, normalizeLocale, type SupportedLocale } from './i18n'

/**
 * Each shipped language named in itself. A reader looking for their own
 * language should not have to read ours first to find it, so this is
 * deliberately endonyms rather than English names.
 */
export const SUPPORTED_LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  ar: 'العربية',
  ru: 'Русский',
  'pt-br': 'Português (Brasil)',
  'zh-cn': '简体中文',
  'zh-tw': '繁體中文',
}

/**
 * The picker entry that means "no stored preference -- follow the browser".
 *
 * Not a language tag, and it cannot be mistaken for one: the stored column
 * accepts a 2-3 letter primary subtag, so nothing a person could store ever
 * collides with this.
 */
export const BROWSER_LANGUAGE_VALUE = '__browser__'

export interface LanguageOption {
  /** The language tag the picker stores and compares on. */
  value: string
  label: string
  /** Whether the product is translated into this language. False only for a
   *  language someone stored for inbox translation that we do not ship. */
  shipped: boolean
}

/**
 * The languages the picker offers to someone whose stored preference is
 * `stored`: the nine we ship, and -- when their stored language is none of
 * those -- that language too.
 *
 * That last entry is the whole reason this is a function rather than a
 * constant. The stored column takes any BCP-47 tag on purpose, because inbox
 * translation has to reach languages the interface will never speak. A picker
 * built from the nine alone shows an empty box to whoever stored one of the
 * others, and their next touch of it overwrites what they had.
 *
 * The browser choice is deliberately not in here. It is a line of copy rather
 * than a language, so the card translates it along with the rest of its
 * wording; this module would have to carry an English string nothing shows.
 */
export function languageOptions(stored: string | null, displayLocale: string): LanguageOption[] {
  const options: LanguageOption[] = []

  for (const locale of SUPPORTED_LOCALES) {
    options.push({ value: locale, label: SUPPORTED_LOCALE_LABELS[locale], shipped: true })
  }

  const kept = unshippedTag(stored)
  if (kept !== null) {
    options.push({ value: kept, label: foreignLanguageName(kept, displayLocale), shipped: false })
  }

  return options
}

/** The entry the picker shows as selected for a stored preference. */
export function selectedLanguageValue(stored: string | null): string {
  const tag = stored?.trim()
  if (!tag) return BROWSER_LANGUAGE_VALUE
  return normalizeLocale(tag) ?? tag
}

/** What to store for a picked entry. The browser choice stores nothing. */
export function optionToPreference(value: string): string | null {
  return value === BROWSER_LANGUAGE_VALUE ? null : value
}

/**
 * The stored tag, when it names a language we do not ship and therefore needs
 * an entry of its own. Null when there is no preference, or when the tag is
 * one of the nine -- `de-DE` is German, and offering it beside `de` would put
 * "Deutsch" on the list twice with the two disagreeing about which is picked.
 */
function unshippedTag(stored: string | null): string | null {
  const tag = stored?.trim()
  if (!tag) return null
  return normalizeLocale(tag) === null ? tag : null
}

/**
 * A language we do not ship, named in the language the reader is reading.
 *
 * Not in English, and the difference is visible: someone can have stored
 * Japanese for their inbox while their browser puts the interface in German,
 * and "auf Japanese übersetzt" is a sentence in neither language. Falls back
 * to the raw tag when `Intl` cannot resolve either argument, so the entry is
 * never blank.
 *
 * The inbox translation banner keeps its own copy of this
 * (`lib/client/hooks/use-inbox-translation.ts`). Sharing one would make a
 * portal settings page import an admin inbox module, and the four lines are
 * cheaper than that edge.
 */
function foreignLanguageName(tag: string, displayLocale: string): string {
  try {
    return new Intl.DisplayNames([displayLocale], { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}
