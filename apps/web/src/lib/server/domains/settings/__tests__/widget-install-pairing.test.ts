/**
 * ## P — Widget install pairing (upstream 98b18e3ee)
 * - P1 The install prompt an admin copies carries a short-lived pairing code
 *   and never the signing secret; the code is minted on copy by an admin with
 *   settings.manage, and a mint failure toasts and copies nothing.
 * - P3 Reading the install status reports a database failure as such.
 * - P7 The install status reports what the site sent: connected only once a
 *   ping was seen, enabled only when the stored config says so, the SDK
 *   versions as stored, and an update request only for a connected site whose
 *   SDK is behind. (Added 2026-09-14 after the mutation run showed the success
 *   path unpinned; confirmed by the user.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { InternalError } from '@/lib/shared/errors'
import { CURRENT_WIDGET_SDK_VERSION } from '@/lib/shared/widget/sdk-version'

// A plain array, not a spy: `logger.child(...)` runs while the module under
// test is imported, and `vi.clearAllMocks()` would wipe a spy's record of the
// lines it wrote. Hoisted, because that import runs before a plain `const`.
const { logLines } = vi.hoisted(() => ({
  logLines: [] as { level: string; args: unknown[] }[],
}))

function recordingLogger() {
  const record =
    (level: string) =>
    (...args: unknown[]) => {
      logLines.push({ level, args })
    }
  return {
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    fatal: record('fatal'),
    child: () => recordingLogger(),
  }
}

vi.mock('@/lib/server/logger', () => ({ logger: recordingLogger() }))

const kvSet = vi.fn()
const requireSettingsCached = vi.fn()
const dbExecute = vi.fn()
const ensureWidgetSecret = vi.fn()
const updateWidgetConfig = vi.fn()
const getBaseUrl = vi.fn(() => 'https://feedback.example.com/')

vi.mock('@/lib/server/kv/pg-kv', () => ({ kvSet: (...a: unknown[]) => kvSet(...a) }))
vi.mock('@/lib/server/db', () => ({ db: { execute: (...a: unknown[]) => dbExecute(...a) } }))
vi.mock('@/lib/server/config', () => ({ getBaseUrl: () => getBaseUrl() }))
// Partial mock: only the settings read is faked, so wrapDbError — the thing
// under test here — stays the real one.
vi.mock('../settings.helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../settings.helpers')>()),
  requireSettingsCached: (...a: unknown[]) => requireSettingsCached(...a),
}))
vi.mock('../settings.widget', () => ({
  ensureWidgetSecret: (...a: unknown[]) => ensureWidgetSecret(...a),
  updateWidgetConfig: (...a: unknown[]) => updateWidgetConfig(...a),
}))

import {
  WIDGET_INSTALL_CODE_MAX_USES,
  WIDGET_INSTALL_CODE_PREFIX,
  WIDGET_INSTALL_CODE_TTL_SECONDS,
  consumeWidgetInstallCode,
  generateWidgetInstallCode,
  getWidgetInstallStatus,
  hashWidgetInstallCode,
  mintWidgetInstallCode,
  redeemWidgetInstallCode,
  widgetInstallPairingKey,
} from '../widget-install-pairing'

beforeEach(() => {
  vi.clearAllMocks()
  logLines.length = 0
  ensureWidgetSecret.mockResolvedValue('wgt_mintedsecret')
  updateWidgetConfig.mockResolvedValue({ enabled: true })
  dbExecute.mockResolvedValue([{ remaining: 1 }])
})

/** The settings columns the install status reads, defaulting to "never seen". */
function settingsWithInstallEvidence(evidence: {
  widgetConfig?: string | null
  widgetInstalledFirstSeenAt?: Date | null
  widgetInstalledLastSeenAt?: Date | null
  widgetInstalledOriginHost?: string | null
  widgetInstalledSdkVersion?: string | null
}) {
  return {
    widgetConfig: null,
    widgetInstalledFirstSeenAt: null,
    widgetInstalledLastSeenAt: null,
    widgetInstalledOriginHost: null,
    widgetInstalledSdkVersion: null,
    ...evidence,
  }
}

describe('generateWidgetInstallCode', () => {
  it('is a short opaque qbi_ code', () => {
    const code = generateWidgetInstallCode()
    expect(code.startsWith(WIDGET_INSTALL_CODE_PREFIX)).toBe(true)
    expect(code.length).toBeGreaterThan(12)
    expect(code).not.toContain('wgt_')
    expect(generateWidgetInstallCode()).not.toBe(code)
  })
})

describe('hashWidgetInstallCode', () => {
  it('is a stable sha256 hex of the trimmed code', () => {
    const hash = hashWidgetInstallCode(' qbi_abc ')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hashWidgetInstallCode('qbi_abc')).toBe(hash)
    expect(hashWidgetInstallCode('qbi_other')).not.toBe(hash)
  })
})

describe('mintWidgetInstallCode', () => {
  it('ensures a secret exists and stores a hashed TTL record with two uses', async () => {
    const minted = await mintWidgetInstallCode()
    expect(ensureWidgetSecret).toHaveBeenCalledTimes(1)
    expect(minted).toEqual({ code: expect.stringMatching(/^qbi_/) })
    expect(kvSet).toHaveBeenCalledWith(
      widgetInstallPairingKey(hashWidgetInstallCode(minted.code)),
      { remaining: WIDGET_INSTALL_CODE_MAX_USES },
      WIDGET_INSTALL_CODE_TTL_SECONDS
    )
  })
})

describe('where a pairing code is stored and for how long', () => {
  it('keeps a pairing code alive for fifteen minutes (P1)', () => {
    expect(WIDGET_INSTALL_CODE_TTL_SECONDS).toBe(900)
  })

  it('namespaces the store key with the pairing prefix (P1)', () => {
    expect(widgetInstallPairingKey('0123abcd')).toBe('widget:install-pairing:0123abcd')
  })

  it('writes the minted code under its hashed key with that lifetime (P1)', async () => {
    const minted = await mintWidgetInstallCode()

    expect(kvSet).toHaveBeenCalledWith(
      `widget:install-pairing:${hashWidgetInstallCode(minted.code)}`,
      { remaining: 2 },
      900
    )
  })

  it('gives two minted codes two different store keys (P1)', async () => {
    await mintWidgetInstallCode()
    await mintWidgetInstallCode()

    const [firstKey] = kvSet.mock.calls[0] as [string]
    const [secondKey] = kvSet.mock.calls[1] as [string]
    expect(firstKey).toMatch(/^widget:install-pairing:[a-f0-9]{64}$/)
    expect(secondKey).not.toBe(firstKey)
  })
})

describe('consumeWidgetInstallCode', () => {
  it('returns true when the statement consumes a live use', async () => {
    dbExecute.mockResolvedValue([{ remaining: 1 }])
    await expect(consumeWidgetInstallCode('qbi_live')).resolves.toBe(true)
  })

  it('returns false for expiry or reuse (no row)', async () => {
    dbExecute.mockResolvedValue([])
    await expect(consumeWidgetInstallCode('qbi_dead')).resolves.toBe(false)
  })
})

describe('redeemWidgetInstallCode', () => {
  it('returns instance URL, sdk URL, and signing secret and enables the widget', async () => {
    const result = await redeemWidgetInstallCode('qbi_ok')
    expect(result).toEqual({
      instanceUrl: 'https://feedback.example.com',
      sdkUrl: 'https://feedback.example.com/api/widget/sdk.js',
      signingSecret: 'wgt_mintedsecret',
    })
    expect(updateWidgetConfig).toHaveBeenCalledWith({ enabled: true })
  })

  it('returns null without enabling when the code is spent or expired', async () => {
    dbExecute.mockResolvedValue([])
    await expect(redeemWidgetInstallCode('qbi_spent')).resolves.toBeNull()
    expect(ensureWidgetSecret).not.toHaveBeenCalled()
    expect(updateWidgetConfig).not.toHaveBeenCalled()
  })
})

describe('getWidgetInstallStatus reports what the instance knows', () => {
  // Older than every release from the current SDK on, so the comparison stays
  // meaningful after the SDK is bumped.
  const behindSdkVersion = '0.1.5'
  const firstSeen = new Date('2026-09-01T10:00:00.000Z')
  const lastSeen = new Date('2026-09-12T08:30:00.000Z')

  it('reports a site that has pinged as connected, with the evidence it sent (P7)', async () => {
    requireSettingsCached.mockResolvedValue(
      settingsWithInstallEvidence({
        widgetConfig: JSON.stringify({ enabled: true }),
        widgetInstalledFirstSeenAt: firstSeen,
        widgetInstalledLastSeenAt: lastSeen,
        widgetInstalledOriginHost: 'shop.example.com',
        widgetInstalledSdkVersion: CURRENT_WIDGET_SDK_VERSION,
      })
    )

    await expect(getWidgetInstallStatus()).resolves.toEqual({
      connected: true,
      enabled: true,
      lastDetectedAt: '2026-09-12T08:30:00.000Z',
      originHost: 'shop.example.com',
      sdkVersion: CURRENT_WIDGET_SDK_VERSION,
      currentSdkVersion: CURRENT_WIDGET_SDK_VERSION,
      sdkNeedsUpdate: false,
    })
  })

  it('reports a site that has never pinged as not connected (P7)', async () => {
    requireSettingsCached.mockResolvedValue(
      settingsWithInstallEvidence({ widgetConfig: JSON.stringify({ enabled: true }) })
    )

    await expect(getWidgetInstallStatus()).resolves.toEqual({
      connected: false,
      enabled: true,
      lastDetectedAt: null,
      originHost: null,
      sdkVersion: null,
      currentSdkVersion: CURRENT_WIDGET_SDK_VERSION,
      sdkNeedsUpdate: false,
    })
  })

  it('reports the widget as off when the stored config says so (P7)', async () => {
    requireSettingsCached.mockResolvedValue(
      settingsWithInstallEvidence({ widgetConfig: JSON.stringify({ enabled: false }) })
    )

    await expect(getWidgetInstallStatus()).resolves.toMatchObject({ enabled: false })
  })

  it('does not read a merely truthy stored flag as on (P7)', async () => {
    requireSettingsCached.mockResolvedValue(
      settingsWithInstallEvidence({ widgetConfig: '{"enabled":"yes"}' })
    )

    await expect(getWidgetInstallStatus()).resolves.toMatchObject({ enabled: false })
  })

  it('asks a connected site running an older SDK to update (P7)', async () => {
    requireSettingsCached.mockResolvedValue(
      settingsWithInstallEvidence({
        widgetConfig: JSON.stringify({ enabled: true }),
        widgetInstalledFirstSeenAt: firstSeen,
        widgetInstalledLastSeenAt: lastSeen,
        widgetInstalledOriginHost: 'shop.example.com',
        widgetInstalledSdkVersion: behindSdkVersion,
      })
    )

    await expect(getWidgetInstallStatus()).resolves.toMatchObject({
      connected: true,
      sdkVersion: behindSdkVersion,
      sdkNeedsUpdate: true,
    })
  })

  it('does not ask a site nobody has seen to update, however old its SDK (P7)', async () => {
    requireSettingsCached.mockResolvedValue(
      settingsWithInstallEvidence({
        widgetConfig: JSON.stringify({ enabled: true }),
        widgetInstalledSdkVersion: behindSdkVersion,
      })
    )

    await expect(getWidgetInstallStatus()).resolves.toMatchObject({
      connected: false,
      sdkNeedsUpdate: false,
    })
  })

  it('never reports an update for a site it has no install evidence for (P7)', async () => {
    const seenAt = fc.option(
      fc.integer({ min: 0, max: 2_000_000_000_000 }).map((ms) => new Date(ms)),
      { nil: null }
    )
    const sdkVersion = fc.constantFrom(
      null,
      '0.0.9',
      behindSdkVersion,
      CURRENT_WIDGET_SDK_VERSION,
      '99.0.0',
      'not-a-version'
    )
    const originHost = fc.option(fc.constantFrom('shop.example.com', 'app.acme.test'), {
      nil: null,
    })
    const storedEnabled = fc.constantFrom<unknown>(true, false, 'yes', 0, null)

    await fc.assert(
      fc.asyncProperty(
        seenAt,
        sdkVersion,
        originHost,
        storedEnabled,
        async (seen, sdk, host, enabled) => {
          requireSettingsCached.mockResolvedValue(
            settingsWithInstallEvidence({
              widgetConfig: JSON.stringify({ enabled }),
              widgetInstalledFirstSeenAt: seen,
              widgetInstalledLastSeenAt: seen,
              widgetInstalledOriginHost: host,
              widgetInstalledSdkVersion: sdk,
            })
          )

          const status = await getWidgetInstallStatus()

          // Holds on every branch: an update prompt needs a site that reported in.
          expect(status.sdkNeedsUpdate && !status.connected).toBe(false)
          expect(status.connected).toBe(seen !== null)
          expect(status.lastDetectedAt).toBe(seen === null ? null : seen.toISOString())
          expect(status.originHost).toBe(host)
          expect(status.sdkVersion).toBe(sdk)
          expect(status.currentSdkVersion).toBe(CURRENT_WIDGET_SDK_VERSION)
          // Only the boolean true is on; a truthy leftover in the stored blob is not.
          expect(status.enabled).toBe(enabled === true)
        }
      ),
      { numRuns: 200 }
    )
  })
})

describe('getWidgetInstallStatus', () => {
  it('reports a database failure as such instead of an empty status (P3)', async () => {
    requireSettingsCached.mockRejectedValue(new Error('connection terminated unexpectedly'))

    await expect(getWidgetInstallStatus()).rejects.toThrow(
      'Failed to fetch widget install status: connection terminated unexpectedly'
    )
  })

  it('raises the failure as a 500 DATABASE_ERROR carrying the original cause (P3)', async () => {
    const cause = new Error('connection terminated unexpectedly')
    requireSettingsCached.mockRejectedValue(cause)

    const error = await getWidgetInstallStatus().catch((raised: unknown) => raised)

    expect(error).toBeInstanceOf(InternalError)
    expect(error).toMatchObject({ code: 'DATABASE_ERROR', statusCode: 500, cause })
  })

  it('leaves the operator a log line naming the failure and its cause (P3)', async () => {
    const cause = new Error('connection terminated unexpectedly')
    requireSettingsCached.mockRejectedValue(cause)

    await expect(getWidgetInstallStatus()).rejects.toBeInstanceOf(InternalError)

    expect(logLines).toContainEqual({
      level: 'error',
      args: [{ err: cause }, 'get widget install status failed'],
    })
  })
})
