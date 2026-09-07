import type { IntlShape } from 'react-intl'
import {
  AUTH_BLOCK_MESSAGES,
  authBlockCodeSlug,
  type AuthBlockCode,
} from '@/lib/shared/auth-block-messages'

/**
 * The sentence for a sign-in outcome, in the language of the person reading it.
 *
 * The code is what crosses the wire; this is the one place that turns it into a
 * sentence. A surface that renders a server-supplied sentence instead is a
 * surface that cannot be translated, which is why the producers keep sending
 * codes and nothing downstream displays their English (S3).
 *
 * A code the product does not know still gets a sentence, never a blank or the
 * raw code (S4). Callers may pass their own, because a surface can know
 * something the generic sentence cannot -- the popup landing knows the reader
 * has another window to go back to. It has to be an object literal with the
 * English beside the id, or the i18n gate cannot see the key.
 *
 * The id is spelled out here as a template literal rather than built by
 * `authBlockMessageId`: the i18n gate reads the source, and an id assembled
 * inside a function is invisible to it, so every key in the namespace would be
 * reported as one nothing reaches.
 */
export function authBlockMessage(
  intl: IntlShape,
  code: string | null | undefined,
  unknownOutcome?: { id: string; defaultMessage: string }
): string {
  const known = code ? AUTH_BLOCK_MESSAGES[code as AuthBlockCode] : undefined
  if (!code || !known) {
    return intl.formatMessage(
      unknownOutcome ?? {
        id: 'portal.auth.error.signinFailed',
        defaultMessage:
          'Sign-in failed. Try again or contact your administrator if the problem persists.',
      }
    )
  }
  return intl.formatMessage({
    id: `auth.blocked.${authBlockCodeSlug(code as AuthBlockCode)}`,
    defaultMessage: known,
  })
}
