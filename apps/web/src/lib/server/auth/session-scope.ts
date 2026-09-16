/**
 * The audience a session is stamped with when Better Auth mints it.
 *
 * Better Auth creates a session at the end of every sign-in path, and exactly
 * one of them is not a person arriving at a dashboard: `/sign-in/anonymous`,
 * which only the widget calls, lazily, for a visitor nobody has identified.
 * Everything else — a password sign-in, a magic link, an SSO callback — is
 * somebody signing in to operate the workspace, and the column's own default
 * already says so.
 *
 * This lives beside the config rather than inside it, which is where upstream
 * keeps it, for the reason `guardBetterAuthUserCreation` lives in
 * signup-policy.ts: a rule inlined into the Better Auth options object runs
 * only when an entire auth instance is stood up, so no test ever reaches it.
 * Passed by reference into the hook slot, it costs the config nothing and can
 * be read on its own.
 */
import type { SessionScope } from '@/lib/shared/roles'

/** The one Better Auth path that mints a session for a visitor nobody identified. */
export const ANONYMOUS_SIGN_IN_PATH = '/sign-in/anonymous'

/**
 * Stamp the row Better Auth is about to insert with the audience it belongs
 * to, or hand back nothing and let the column's default stand.
 *
 * Returning `undefined` rather than an explicit `scope: 'dashboard'` keeps the
 * library's own row shape for every path but one: the default is declared on
 * the field, and writing it a second time here would be two places to keep
 * agreeing.
 */
export async function stampSessionAudience<T extends object>(
  sessionData: T,
  ctx?: { path?: string } | null
): Promise<{ data: T & { scope: SessionScope } } | undefined> {
  if (ctx?.path !== ANONYMOUS_SIGN_IN_PATH) return undefined
  return { data: { ...sessionData, scope: 'widget' } }
}
