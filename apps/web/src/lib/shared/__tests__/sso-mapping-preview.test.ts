import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import type { IdentityProviderClaimMapping } from '../oidc-claim-mapping'
import {
  captureConfigIsStale,
  effectiveEmailPath,
  effectiveNamePath,
  previewClaimMapping,
  selectMappingCapture,
} from '../sso-mapping-preview'
import type { SsoTestCapture } from '../sso-test-capture'

/**
 * Contract for `sso-mapping-preview.ts`, confirmed before these tests were
 * written (module doc: "Draft mapping preview. Replays captured source
 * snapshots through the same binder production uses. No alternate value
 * extraction.").
 *
 * V1 The preview never derives identity/role/people results from any claim
 *    data other than what the selected capture actually recorded and replays
 *    through the same binder production sign-in uses.
 * V2 Configuration staleness is computed relative to the instant the capture
 *    actually reflects — the handshake's start for a replayable capture, or
 *    the capture's own timestamp for a legacy one — never relative to the
 *    current wall-clock time: it is false whenever current details changed at
 *    or before that instant, and can only be true when they changed strictly
 *    after it.
 * V3 effectiveIdPath/effectiveEmailPath/effectiveNamePath return the draft's
 *    configured claim path when the admin set one, and otherwise a fixed
 *    standard default (`sub`/`email`/`name`) — never any other value.
 * V4 A capture recorded for a different provider, or missing a source the
 *    current draft configuration requires, is never used to produce an
 *    identity/role/people result — the preview reports "needs retest".
 */

const REG = 'oidc_x'

function v2Capture(over: Partial<SsoTestCapture> = {}): SsoTestCapture {
  return {
    version: 2,
    registrationId: REG,
    capturedAt: '2026-09-01T00:00:00.000Z',
    detailsChangedAtAtStart: null,
    outcome: 'success',
    identity: {
      id: 'person-123',
      email: 'jane@example.test',
      name: 'Jane',
      sources: { id: 'idToken' },
    },
    claims: {
      sub: 'person-123',
      email: 'Jane@Example.TEST',
      name: 'Jane',
      groups: ['engineering'],
    },
    replay: {
      sources: [
        {
          source: 'idToken',
          claims: {
            sub: 'person-123',
            email: 'Jane@Example.TEST',
            name: 'Jane',
            groups: ['engineering'],
          },
        },
        { source: 'userinfo', claims: { sub: 'person-123', department: 'Engineering' } },
      ],
    },
    ...over,
  }
}

const defs = [{ key: 'department', type: 'string' as const, label: 'Department' }]
const policy = {
  autoCreateUsers: true,
  autoProvisionRole: 'user' as const,
  registrationId: REG,
}

describe('selectMappingCapture', () => {
  it('wrong provider capture is ignored', () => {
    expect(
      selectMappingCapture({
        registrationId: REG,
        sessionCapture: v2Capture({ registrationId: 'oidc_other' }),
        persistedCapture: v2Capture({ registrationId: 'oidc_other' }),
      })
    ).toBeNull()
  })

  it('newer failed mapping capture supersedes old success for debugging', () => {
    const olderSuccess = v2Capture({
      capturedAt: '2026-09-01T00:00:00.000Z',
      outcome: 'success',
    })
    const newerFail = v2Capture({
      capturedAt: '2026-09-01T01:00:00.000Z',
      outcome: 'mapping_failed',
      identity: undefined,
    })
    const selected = selectMappingCapture({
      registrationId: REG,
      sessionCapture: newerFail,
      persistedCapture: olderSuccess,
    })
    expect(selected?.outcome).toBe('mapping_failed')
    expect(selected?.capturedAt).toBe('2026-09-01T01:00:00.000Z')
  })
})

describe('previewClaimMapping', () => {
  it('preview uses production binder for unsaved draft', () => {
    const draft: IdentityProviderClaimMapping = {
      profile: { claims: { email: 'upn' } },
    }
    const capture = v2Capture({
      replay: {
        sources: [
          {
            source: 'idToken',
            claims: {
              sub: 'person-123',
              upn: 'Jane@Idp.Example',
              email: 'other@x.test',
              name: 'Jane',
            },
          },
          { source: 'userinfo', claims: { sub: 'person-123' } },
        ],
      },
    })
    const preview = previewClaimMapping({
      draft,
      capture,
      definitions: defs,
      providerPolicy: policy,
    })
    expect(preview.status).toBe('ready')
    expect(preview.identity?.email).toBe('jane@idp.example')
    expect(preview.identity?.provenance.email?.path).toBe('upn')
    expect(preview.identity?.id).toBe('person-123')
  })

  it('wrong provider capture is ignored', () => {
    const preview = previewClaimMapping({
      draft: null,
      capture: v2Capture({ registrationId: 'oidc_other' }),
      definitions: defs,
      providerPolicy: policy,
    })
    expect(preview.capture).toBeNull()
    expect(preview.identity).toBeNull()
  })

  it('marks a session capture stale when details changed after the handshake started', () => {
    const preview = previewClaimMapping({
      draft: null,
      capture: v2Capture({
        detailsChangedAtAtStart: '2026-09-01T00:00:00.000Z',
        capturedAt: '2026-09-01T00:02:00.000Z',
      }),
      definitions: defs,
      providerPolicy: { ...policy, detailsChangedAt: '2026-09-01T00:01:00.000Z' },
    })
    expect(preview.stale).toBe(true)
    expect(preview.capture).not.toBeNull()
    expect(preview.limitations.join(' ')).toMatch(/re-test/i)
  })

  it('does not mark stale when current details match the handshake start', () => {
    const preview = previewClaimMapping({
      draft: null,
      capture: v2Capture({
        detailsChangedAtAtStart: '2026-09-01T00:00:00.000Z',
        capturedAt: '2026-09-01T00:02:00.000Z',
      }),
      definitions: defs,
      providerPolicy: { ...policy, detailsChangedAt: '2026-09-01T00:00:00.000Z' },
    })
    expect(preview.stale).toBe(false)
    expect(preview.limitations.join(' ')).not.toMatch(/re-test/i)
  })

  it('legacy capture asks for retest', () => {
    const capture: SsoTestCapture = {
      registrationId: REG,
      capturedAt: '2026-09-01T00:00:00.000Z',
      identity: { id: 'person-123', email: 'jane@example.test', sources: { id: 'idToken' } },
      claims: { sub: 'person-123', email: 'jane@example.test' },
    }
    const preview = previewClaimMapping({
      draft: null,
      capture,
      definitions: defs,
      providerPolicy: policy,
    })
    expect(preview.status).toBe('needs_retest')
    expect(preview.limitations.join(' ')).toMatch(/preview mappings accurately/i)
    expect(preview.identity).toBeNull()
  })

  it('source change never invents provenance', () => {
    const draft: IdentityProviderClaimMapping = {
      profile: { sources: ['idToken', 'userinfo', 'accessTokenJwt'] },
    }
    const preview = previewClaimMapping({
      draft,
      capture: v2Capture(),
      definitions: defs,
      providerPolicy: policy,
    })
    expect(preview.status).toBe('needs_retest')
    expect(preview.missingSource).toBe('accessTokenJwt')
    expect(preview.identity).toBeNull()
  })

  it('role preview warns about off-domain admin rules even if test matches member', () => {
    const draft: IdentityProviderClaimMapping = {
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'platform-admins', role: 'admin' },
          { whenContains: 'engineering', role: 'member' },
        ],
      },
    }
    const preview = previewClaimMapping({
      draft,
      capture: v2Capture(),
      definitions: defs,
      providerPolicy: policy,
    })
    expect(preview.roleMatch).toEqual({ role: 'member', ruleIndex: 1 })
    expect(draft.role?.rules.some((r) => r.role === 'admin')).toBe(true)
  })

  it('auto-create off suppresses role application but not People preview', () => {
    const draft: IdentityProviderClaimMapping = {
      role: { claimPath: 'groups', rules: [{ whenContains: 'engineering', role: 'member' }] },
      attributes: { map: [{ claimPath: 'department', attributeKey: 'department' }] },
    }
    const preview = previewClaimMapping({
      draft,
      capture: v2Capture(),
      definitions: defs,
      providerPolicy: { ...policy, autoCreateUsers: false },
    })
    expect(preview.roleMatch?.role).toBe('member')
    expect(preview.peoplePlan?.valid.department).toBe('Engineering')
  })

  it('placeholder preview never generates an address', () => {
    const draft: IdentityProviderClaimMapping = {
      profile: { allowMissingEmail: true },
    }
    const capture = v2Capture({
      replay: {
        sources: [
          { source: 'idToken', claims: { sub: 'person-123', name: 'Jane' } },
          { source: 'userinfo', claims: { sub: 'person-123' } },
        ],
      },
    })
    const preview = previewClaimMapping({
      draft,
      capture,
      definitions: defs,
      providerPolicy: policy,
    })
    expect(preview.identity?.kind).toBe('placeholder_required')
    expect(preview.identity?.email).toBeUndefined()
    expect(preview.identity?.placeholderEmail).toBe(true)
  })

  it('metadata preview cannot claim existing values were kept', () => {
    const draft: IdentityProviderClaimMapping = {
      attributes: {
        map: [{ claimPath: 'department', attributeKey: 'department' }],
        overrideExisting: false,
      },
    }
    const preview = previewClaimMapping({
      draft,
      capture: v2Capture(),
      definitions: defs,
      providerPolicy: policy,
    })
    expect(preview.peoplePlan?.skips?.some((s) => s.reason === 'kept_existing')).toBeFalsy()
    expect(preview.peoplePlan?.valid.department).toBe('Engineering')
  })

  it('newer failed mapping capture still previews the draft', () => {
    const capture = v2Capture({
      outcome: 'mapping_failed',
      identity: undefined,
      replay: {
        sources: [
          {
            source: 'idToken',
            claims: { sub: 'person-123', upn: 'jane@example.test', name: 'Jane' },
          },
          { source: 'userinfo', claims: { sub: 'person-123' } },
        ],
      },
    })
    const preview = previewClaimMapping({
      draft: { profile: { claims: { email: 'upn' } } },
      capture,
      definitions: defs,
      providerPolicy: policy,
    })
    expect(preview.status).toBe('mapping_failed')
    expect(preview.identity?.email).toBe('jane@example.test')
  })
})

describe('captureConfigIsStale (V2)', () => {
  it('a legacy (non-replayable) capture is judged against its own capturedAt timestamp', () => {
    const legacyCapture: SsoTestCapture = {
      registrationId: REG,
      capturedAt: '2026-09-01T00:00:00.000Z',
      identity: { id: 'person-123', sources: { id: 'idToken' } },
      claims: { sub: 'person-123' },
    }
    expect(captureConfigIsStale('2026-09-01T00:01:00.000Z', legacyCapture)).toBe(true)
    expect(captureConfigIsStale('2026-08-31T23:59:00.000Z', legacyCapture)).toBe(false)
    expect(captureConfigIsStale('2026-09-01T00:00:00.000Z', legacyCapture)).toBe(false)
  })

  it('no detailsChangedAt is never stale, whatever the capture looks like', () => {
    const legacyCapture: SsoTestCapture = {
      registrationId: REG,
      capturedAt: '2026-09-01T00:00:00.000Z',
      identity: { id: 'person-123', sources: { id: 'idToken' } },
      claims: { sub: 'person-123' },
    }
    expect(captureConfigIsStale(null, legacyCapture)).toBe(false)
    expect(captureConfigIsStale(undefined, legacyCapture)).toBe(false)
    expect(captureConfigIsStale(null, v2Capture())).toBe(false)
  })
})

describe('effectiveEmailPath / effectiveNamePath (V3)', () => {
  it('effectiveEmailPath returns the configured claim, or "email" when none is set', () => {
    expect(effectiveEmailPath(null)).toBe('email')
    expect(effectiveEmailPath({ profile: { claims: { email: 'upn' } } })).toBe('upn')
  })

  it('effectiveNamePath returns the configured claim, or "name" when none is set', () => {
    expect(effectiveNamePath(null)).toBe('name')
    expect(effectiveNamePath({ profile: { claims: { name: 'displayName' } } })).toBe('displayName')
  })
})

describe('property-based tests (fast-check)', () => {
  const nonBlankClaimPath = fc
    .string({ minLength: 1, maxLength: 24 })
    .filter((s) => s.trim().length > 0 && s === s.trim())

  it('V3: effective path is exactly the configured claim, else exactly the fixed default', () => {
    fc.assert(
      fc.property(
        fc.option(nonBlankClaimPath, { nil: undefined }),
        fc.option(nonBlankClaimPath, { nil: undefined }),
        (emailPath, namePath) => {
          const draft = { profile: { claims: { email: emailPath, name: namePath } } }
          const email = effectiveEmailPath(draft)
          const name = effectiveNamePath(draft)
          expect(email).toBe(emailPath === undefined ? 'email' : emailPath)
          expect(name).toBe(namePath === undefined ? 'name' : namePath)
        }
      )
    )
  })

  it('V2: staleness never fires at or before the reference instant, and always fires strictly after it (legacy capture)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        (baseOffsetMs, deltaMs) => {
          const referenceMs = Date.parse('2026-01-01T00:00:00.000Z') + baseOffsetMs
          const capture: SsoTestCapture = {
            registrationId: REG,
            capturedAt: new Date(referenceMs).toISOString(),
            identity: { id: 'person-123', sources: { id: 'idToken' } },
            claims: { sub: 'person-123' },
          }
          const atOrBefore = new Date(referenceMs - deltaMs).toISOString()
          const strictlyAfter = new Date(referenceMs + deltaMs + 1).toISOString()
          expect(captureConfigIsStale(atOrBefore, capture)).toBe(false)
          expect(captureConfigIsStale(strictlyAfter, capture)).toBe(true)
        }
      )
    )
  })

  it('V2: staleness for a replayable capture is anchored to the handshake start, not capturedAt', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        (baseOffsetMs, deltaMs) => {
          const startMs = Date.parse('2026-01-01T00:00:00.000Z') + baseOffsetMs
          const capture = v2Capture({
            detailsChangedAtAtStart: new Date(startMs).toISOString(),
            // capturedAt deliberately far later than the handshake start, so a
            // property that mistakenly anchored on capturedAt instead would
            // disagree with one anchored on the start time.
            capturedAt: new Date(startMs + 60_000).toISOString(),
          })
          const atOrBefore = new Date(startMs - deltaMs).toISOString()
          const strictlyAfter = new Date(startMs + deltaMs + 1).toISOString()
          expect(captureConfigIsStale(atOrBefore, capture)).toBe(false)
          expect(captureConfigIsStale(strictlyAfter, capture)).toBe(true)
        }
      )
    )
  })
})
