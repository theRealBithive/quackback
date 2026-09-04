/**
 * Status page settings — client-safe types + defaults, mirroring the
 * changelog settings pattern (no dedicated DB column; the values ride in the
 * `settings.metadata` JSON bag under the `statusSettings` key, see
 * `domains/settings/settings.status.ts`).
 */
import { z } from 'zod'

/**
 * Page visibility ladder: public visitors, signed-in portal users, or only
 * signed-in users sharing one of `allowedSegmentIds`. The portal's own access
 * gate always applies first. Components can additionally be narrowed to
 * segments via `statusComponents.segmentIds`.
 */
export type StatusAudience = 'public' | 'authenticated' | 'segments'

export interface StatusSettings {
  /**
   * Legacy unpublish override, NOT the product switch — that is
   * `featureFlags.statusPage`, the Status toggle on Settings → General.
   * Only an explicit `false` means anything here: it holds the page back
   * even while the General toggle is on. A workspace that never expressed a
   * choice resolves to `true`, so it simply follows its toggle. Effective
   * published state is {@link isStatusPagePublished}.
   */
  enabled: boolean
  /**
   * @deprecated Ignored at read time. Portal chrome is Portal → Navigation.
   */
  portalTabEnabled: boolean
  audience: StatusAudience
  /** Segments allowed to view the page when audience = 'segments'. */
  allowedSegmentIds: string[]
  /** Workspace-wide kill switch for all status emails. */
  emailsDisabled: boolean
  /** Optional blurb under the public page header. */
  pageDescription: string | null
}

export const DEFAULT_STATUS_SETTINGS: StatusSettings = {
  // "No unpublish override", not "the status page is on" — the page is off by
  // default because DEFAULT_FEATURE_FLAGS.statusPage is false. This used to be
  // `false`, which made an unwritten bit indistinguishable from a deliberate
  // no: every install that reached `statusPage: true` without passing through
  // the General toggle (an older version, a seed) showed an ON toggle over a
  // dark page, with no control anywhere to reconcile the two.
  enabled: true,
  portalTabEnabled: true,
  audience: 'public',
  allowedSegmentIds: [],
  emailsDisabled: false,
  pageDescription: null,
}

/**
 * Effective status-page publish state: the General product flag, minus an
 * explicit unpublish override. `enabled !== false` is what lets a workspace
 * that never stored the bit follow its General toggle, while one that
 * deliberately stored `false` stays dark until the toggle is flipped on
 * (which clears the override).
 */
export function isStatusPagePublished(
  flags: { statusPage?: boolean } | null | undefined,
  statusSettings: { enabled?: boolean } | null | undefined
): boolean {
  return !!flags?.statusPage && statusSettings?.enabled !== false
}

export const statusSettingsSchema = z
  .object({
    enabled: z.boolean(),
    audience: z.enum(['public', 'authenticated', 'segments']),
    allowedSegmentIds: z.array(z.string()),
    emailsDisabled: z.boolean(),
    pageDescription: z.string().max(500).nullable(),
  })
  .partial()

export type UpdateStatusSettingsInput = z.infer<typeof statusSettingsSchema>
