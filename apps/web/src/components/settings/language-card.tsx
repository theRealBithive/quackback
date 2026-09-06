import { useIntl, FormattedMessage } from 'react-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouteContext, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  getMyLanguagePreferenceFn,
  setMyLanguagePreferenceFn,
} from '@/lib/server/functions/teammate-preferences'
import { isTeamMember } from '@/lib/shared/roles'
import {
  BROWSER_LANGUAGE_VALUE,
  languageOptions,
  optionToPreference,
  selectedLanguageValue,
} from '@/lib/shared/language-choice'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * The query key `use-inbox-translation.ts` reads this preference under. Shared
 * on purpose: the inbox banner compares a customer's language against this
 * person's own, and a stale answer there would contradict the choice they just
 * made here.
 */
const LANGUAGE_PREFERENCE_QUERY_KEY = ['teammate', 'language-preference']

/**
 * Where a signed-in person chooses the language the product speaks to them.
 *
 * One stored value answers two questions, and the card says so rather than
 * leaving it to be discovered: it is the language of the interface, and it is
 * the language customer messages are translated into for a teammate. The two
 * can disagree about what is possible -- the column takes any BCP-47 tag
 * because inbox translation has to reach every language a teammate might
 * read, while the interface only speaks the nine we have catalogues for -- so
 * a stored language we do not ship leaves the interface in English and keeps
 * translating messages. That is the case the note below names.
 *
 * Nothing here resolves a locale. Storing the preference and re-running the
 * loaders is the whole of it; `bootstrap.ts` decides what the stored value
 * means, once, for the interface and the document's `<html lang>` alike.
 */
export function LanguageCard() {
  const intl = useIntl()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { userRole } = useRouteContext({ from: '__root__' })
  const hasInbox = isTeamMember(userRole)

  const preference = useQuery({
    queryKey: LANGUAGE_PREFERENCE_QUERY_KEY,
    queryFn: () => getMyLanguagePreferenceFn().then((result) => result.language),
    staleTime: 5 * 60_000,
  })

  const save = useMutation({
    mutationFn: (language: string | null) => setMyLanguagePreferenceFn({ data: { language } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: LANGUAGE_PREFERENCE_QUERY_KEY })
      // Every page's messages come from a loader, and the locale they load
      // under is resolved in the request bootstrap -- so re-running the
      // loaders is what makes the new language take effect everywhere at
      // once, with no sign-out and no manual reload.
      await router.invalidate()
      toast.success(
        intl.formatMessage({
          id: 'portal.settings.preferences.language.saved',
          defaultMessage: 'Language saved.',
        })
      )
    },
    onError: () => {
      toast.error(
        intl.formatMessage({
          id: 'portal.settings.preferences.language.failed',
          defaultMessage: 'Your language could not be saved. Please try again.',
        })
      )
    },
  })

  const stored = preference.data ?? null
  const selected = selectedLanguageValue(stored)
  const options = languageOptions(stored, intl.locale)
  const untranslated = options.find((option) => option.value === selected && !option.shipped)

  return (
    <div
      className="rounded-xl border border-border/50 bg-card p-6 shadow-sm animate-in fade-in duration-200 fill-mode-backwards"
      style={{ animationDelay: '225ms' }}
    >
      <h2 className="font-medium mb-1">
        <FormattedMessage
          id="portal.settings.preferences.language.title"
          defaultMessage="Language"
        />
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        {hasInbox ? (
          <FormattedMessage
            id="portal.settings.preferences.language.descriptionWithInbox"
            defaultMessage="The language the app speaks to you in. Customer messages in your inbox are translated into it too."
          />
        ) : (
          <FormattedMessage
            id="portal.settings.preferences.language.description"
            defaultMessage="The language the app speaks to you in."
          />
        )}
      </p>

      <Select
        value={selected}
        disabled={preference.isPending || save.isPending}
        onValueChange={(value) => save.mutate(optionToPreference(value))}
      >
        <SelectTrigger
          className="w-full sm:w-72"
          aria-label={intl.formatMessage({
            id: 'portal.settings.preferences.language.selectLabel',
            defaultMessage: 'Interface language',
          })}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={BROWSER_LANGUAGE_VALUE}>
            <FormattedMessage
              id="portal.settings.preferences.language.browser"
              defaultMessage="Follow my browser"
            />
          </SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {untranslated && (
        <p className="text-xs text-muted-foreground mt-3">
          {hasInbox ? (
            <FormattedMessage
              id="portal.settings.preferences.language.untranslatedWithInbox"
              defaultMessage="We have not translated the app into {language} yet, so the interface stays in English. Customer messages are still translated into {language}."
              values={{ language: untranslated.label }}
            />
          ) : (
            <FormattedMessage
              id="portal.settings.preferences.language.untranslated"
              defaultMessage="We have not translated the app into {language} yet, so the interface stays in English."
              values={{ language: untranslated.label }}
            />
          )}
        </p>
      )}
    </div>
  )
}
