/**
 * Contract — when the status page is live.
 *
 *   V1  What the admin sees on Settings → General and whether visitors can see
 *       the page are the same statement.
 *   V2  There is no state in which the page is dark and the admin cannot find
 *       a switch that turns it on.
 *   V3  A workspace that explicitly held the page back stays dark. A workspace
 *       that never expressed a choice follows its General toggle.
 *   V4  Publishing says nothing about who may look. The audience ladder
 *       (public / authenticated / segments) is decided separately and is not
 *       touched by the publish decision.
 *
 * The bug this pins: publishing needs two bits — `featureFlags.statusPage`
 * (the General toggle) and `statusSettings.enabled` (no UI anywhere). The
 * second is written only inside `if (input.statusPage === true)` in
 * updateFeatureFlags, and the General page sends a Partial, so the write
 * happens only while that one toggle is being flipped ON. Any workspace that
 * arrived at `statusPage: true` some other way — an older version, a seed —
 * never got the bit. `isStatusPagePublished` was written to tolerate that
 * ("enabled !== false"), but every caller feeds it a value already resolved
 * through DEFAULT_STATUS_SETTINGS, where `enabled` was false. Absence was
 * therefore indistinguishable from a deliberate no, the page stayed dark, and
 * the admin saw a toggle that said on.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveStatusSettings } from '../settings.status'
import { isStatusPagePublished } from '@/lib/shared/status-settings'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..')

function read(relativeToSrc: string): string {
  return readFileSync(join(SRC, relativeToSrc), 'utf-8')
}

/** The stored `settings.metadata` JSON for a workspace, as the row holds it. */
function metadata(bag: Record<string, unknown> | null): string | null {
  return bag === null ? null : JSON.stringify(bag)
}

/** Is the page live for this stored metadata and General toggle? */
function published(storedMetadata: string | null, statusPage: boolean): boolean {
  return isStatusPagePublished({ statusPage }, resolveStatusSettings(storedMetadata))
}

describe('status page publish state', () => {
  it('follows the General toggle when the workspace never expressed a choice (V1, V3)', () => {
    // The row exists and holds other things, but nothing ever wrote
    // statusSettings — the state every pre-existing install is in.
    expect(published(metadata({ someOtherFamily: { a: 1 } }), true)).toBe(true)
  })

  it('follows the General toggle when there is no metadata at all (V1, V3)', () => {
    expect(published(metadata(null), true)).toBe(true)
  })

  it('stays dark when the workspace explicitly held the page back (V3)', () => {
    expect(published(metadata({ statusSettings: { enabled: false } }), true)).toBe(false)
  })

  it('is live when both the toggle and an explicit yes agree (V1)', () => {
    expect(published(metadata({ statusSettings: { enabled: true } }), true)).toBe(true)
  })

  it.each([
    ['no choice expressed', { someOtherFamily: { a: 1 } }],
    ['an explicit yes', { statusSettings: { enabled: true } }],
    ['an explicit no', { statusSettings: { enabled: false } }],
  ])('stays dark with the General toggle off, given %s (V1)', (_name, bag) => {
    expect(published(metadata(bag), false)).toBe(false)
  })

  it('does not let the audience ladder decide whether the page is published (V4)', () => {
    // Same publish state either way — who may look is a separate question.
    const forEveryone = metadata({ statusSettings: { audience: 'public' } })
    const forSegments = metadata({
      statusSettings: { audience: 'segments', allowedSegmentIds: ['seg_1'] },
    })

    expect(published(forSegments, true)).toBe(published(forEveryone, true))
  })

  it('keeps the audience a workspace chose (V4)', () => {
    const resolved = resolveStatusSettings(
      metadata({ statusSettings: { audience: 'authenticated' } })
    )

    expect(resolved.audience).toBe('authenticated')
  })

  it('defaults the audience to public when nothing was chosen (V4)', () => {
    expect(resolveStatusSettings(metadata(null)).audience).toBe('public')
  })

  it('treats a settings object that has not loaded as no override (V1)', () => {
    // The helper takes the raw shape too, where the bit can be absent rather
    // than resolved. Absent is not a no.
    expect(isStatusPagePublished({ statusPage: true }, undefined)).toBe(true)
    expect(isStatusPagePublished({ statusPage: true }, null)).toBe(true)
    expect(isStatusPagePublished({ statusPage: true }, {})).toBe(true)
  })

  it('treats unreadable metadata as no choice rather than as a no (V3)', () => {
    expect(published('not json at all', true)).toBe(true)
  })
})

/**
 * Source scans, the instrument this repo already uses for status server fns
 * (functions/__tests__/status-roles.test.ts) and for job handlers
 * (jobs/__tests__/handler-imports.test.ts). Weaker than a behavioural test —
 * they pin how the code is written, not what it does — but standing the whole
 * overview endpoint up behind requireAuth to assert one boolean is not
 * proportionate, and these catch exactly the two regressions that happened.
 */
describe('the admin surfaces agree with the public one', () => {
  function overviewFnSource(): string {
    const source = read('lib/server/functions/status.ts')
    const match = source.match(/export const getStatusOverviewAdminFn[\s\S]*?\n\}\)/)
    expect(match, 'getStatusOverviewAdminFn not found').not.toBeNull()
    return match![0]
  }

  it('the overview reports the composed publish state, not the raw override (V1)', () => {
    const fn = overviewFnSource()

    expect(fn).toContain('isStatusPagePublished')
    expect(fn).not.toMatch(/enabled:\s*settings\.enabled\b/)
  })

  function noticeNavigateTarget(): string {
    const source = read('components/admin/status/status-overview-view.tsx')
    const notice = source.match(/function DisabledNotice\(\)[\s\S]*?\n\}/)
    expect(notice, 'DisabledNotice not found').not.toBeNull()
    const target = notice![0].match(/navigate\(\{\s*to:\s*'([^']+)'/)
    expect(target, 'DisabledNotice navigates nowhere').not.toBeNull()
    return target![1]
  }

  it('the "page is off" notice leads somewhere that can turn it on (V2)', () => {
    // Not pinned to a literal route: whichever page the button points at has
    // to be one that can write feature flags, so moving the control and
    // repointing the button keeps this green.
    //
    // First written as "the route file mentions statusPage", which stated the
    // contract wrongly — the General page renders its toggles from
    // PRODUCT_DEFINITIONS, so the flag name lives in the catalogue and never
    // appears in the route. Writing feature flags is the capability that
    // actually turns the page on, and it still tells the two pages apart:
    // settings.status.tsx cannot write them at all.
    const target = noticeNavigateTarget()
    const routeFile = `routes/admin/settings.${target.split('/').pop()}.tsx`

    expect(read(routeFile)).toContain('updateFeatureFlagsFn')
  })
})
