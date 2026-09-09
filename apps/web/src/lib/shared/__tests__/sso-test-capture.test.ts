import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  captureIdentityCaption,
  captureSuggestionClaims,
  isReplayableCapture,
  parseSsoTestCapture,
} from '../sso-test-capture'

/**
 * Contract for `sso-test-capture.ts`, confirmed before these tests were
 * written (module doc: "Tolerate a missing or malformed column; never fail a
 * provider list.").
 *
 * V1 Parsing a malformed or partially-invalid stored capture never throws —
 *    it always returns null instead, so a bad database column can never fail
 *    the identity-provider list or detail read.
 * V2 A source-snapshot entry is accepted only if it is either a genuine
 *    claims record or a valid "unavailable" reason for a known source name;
 *    an entry naming a known source but supplying neither is rejected — the
 *    whole capture parses to null — rather than accepted as an ambiguous or
 *    empty snapshot.
 * V3 A V2 capture is accepted only with a valid outcome ('success' or
 *    'mapping_failed') and a `replay.sources` array whose every entry is
 *    independently valid — one invalid source entry anywhere invalidates the
 *    whole capture, it is not simply dropped.
 */

describe('parseSsoTestCapture', () => {
  const valid = {
    registrationId: 'oidc_x',
    capturedAt: '2026-08-15T12:00:00.000Z',
    identity: {
      id: 'u1',
      email: 'jane@acme.com',
      name: 'Jane',
      sources: { id: 'idToken', email: 'idToken' },
    },
    claims: { email: 'jane@acme.com', groups: ['eng'] },
  }

  it('returns the fixture as stored, including email and groups', () => {
    const parsed = parseSsoTestCapture(valid)
    expect(parsed).toEqual(valid)
  })

  it('carries the avatar URL and its provenance when present', () => {
    const withImage = {
      ...valid,
      identity: {
        ...valid.identity,
        image: 'https://cdn.acme.com/jane.png',
        sources: { ...valid.identity.sources, image: 'userinfo' },
      },
    }
    expect(parseSsoTestCapture(withImage)).toEqual(withImage)
  })

  it('drops a non-string image', () => {
    const parsed = parseSsoTestCapture({
      ...valid,
      identity: { ...valid.identity, image: 42 },
    })
    expect(parsed?.identity?.image).toBeUndefined()
  })

  it('returns null for missing or malformed payloads', () => {
    expect(parseSsoTestCapture(null)).toBeNull()
    expect(parseSsoTestCapture({})).toBeNull()
    expect(parseSsoTestCapture({ ...valid, identity: { email: 'x' } })).toBeNull()
    expect(parseSsoTestCapture({ ...valid, claims: null })).toBeNull()
  })

  it('legacy capture remains inspectable but is not exact replay', () => {
    const parsed = parseSsoTestCapture(valid)
    expect(parsed).not.toBeNull()
    expect(isReplayableCapture(parsed!)).toBe(false)
    expect(captureIdentityCaption(parsed!)).toBe('jane@acme.com')
  })

  it('parses a V2 capture with optional identity', () => {
    const v2 = {
      version: 2,
      registrationId: 'oidc_x',
      capturedAt: '2026-09-07T12:00:00.000Z',
      detailsChangedAtAtStart: null,
      outcome: 'mapping_failed',
      claims: { sub: 'u1', upn: 'jane@acme.com' },
      replay: {
        sources: [
          { source: 'idToken', claims: { sub: 'u1' } },
          { source: 'userinfo', unavailable: 'fetch_failed' },
        ],
      },
    }
    const parsed = parseSsoTestCapture(v2)
    expect(parsed).toMatchObject({ version: 2, outcome: 'mapping_failed' })
    expect(parsed && 'identity' in parsed ? parsed.identity : undefined).toBeUndefined()
    expect(isReplayableCapture(parsed!)).toBe(true)
    expect(captureIdentityCaption(parsed!)).toBe('Not supplied')
  })

  it('rejects a V2 capture with an unknown source', () => {
    expect(
      parseSsoTestCapture({
        version: 2,
        registrationId: 'oidc_x',
        capturedAt: '2026-09-07T12:00:00.000Z',
        detailsChangedAtAtStart: null,
        outcome: 'success',
        claims: {},
        replay: { sources: [{ source: 'scim', claims: {} }] },
      })
    ).toBeNull()
  })

  it('rejects a V2 capture whose source entry has neither claims nor an unavailable reason (V2)', () => {
    expect(
      parseSsoTestCapture({
        version: 2,
        registrationId: 'oidc_x',
        capturedAt: '2026-09-07T12:00:00.000Z',
        detailsChangedAtAtStart: null,
        outcome: 'success',
        claims: { sub: 'u1' },
        // A known source name, but no `claims` record and no `unavailable`
        // reason — an ambiguous snapshot the parser must not guess about.
        replay: { sources: [{ source: 'idToken' }] },
      })
    ).toBeNull()
  })

  it('rejects a V2 capture whose unavailable reason is not one of the known ones (V2)', () => {
    expect(
      parseSsoTestCapture({
        version: 2,
        registrationId: 'oidc_x',
        capturedAt: '2026-09-07T12:00:00.000Z',
        detailsChangedAtAtStart: null,
        outcome: 'success',
        claims: { sub: 'u1' },
        replay: { sources: [{ source: 'idToken', unavailable: 'gremlins' }] },
      })
    ).toBeNull()
  })
})

describe('property-based tests (fast-check)', () => {
  it('V1: parsing never throws, for any input at all', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(() => parseSsoTestCapture(value)).not.toThrow()
      })
    )
  })

  const KNOWN_SOURCES = ['idToken', 'userinfo', 'accessTokenJwt'] as const
  const KNOWN_UNAVAILABLE = ['absent', 'unreadable', 'fetch_failed'] as const

  const genGoodSnapshot = () =>
    fc.oneof(
      fc.record({
        source: fc.constantFrom(...KNOWN_SOURCES),
        claims: fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.string()),
      }),
      fc.record({
        source: fc.constantFrom(...KNOWN_SOURCES),
        unavailable: fc.constantFrom(...KNOWN_UNAVAILABLE),
      })
    )

  const genAmbiguousSnapshot = () => fc.record({ source: fc.constantFrom(...KNOWN_SOURCES) })

  const genV2Shell = (sourcesArb: fc.Arbitrary<unknown[]>) =>
    fc.record({
      version: fc.constant(2),
      registrationId: fc.string({ minLength: 1, maxLength: 10 }),
      capturedAt: fc.constant('2026-09-07T12:00:00.000Z'),
      detailsChangedAtAtStart: fc.constant(null),
      outcome: fc.constantFrom('success', 'mapping_failed'),
      claims: fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.string()),
      replay: sourcesArb.map((sources) => ({ sources })),
    })

  it('V3: a capture whose replay sources are all well-formed always parses', () => {
    fc.assert(
      fc.property(
        genV2Shell(fc.array(genGoodSnapshot(), { minLength: 1, maxLength: 4 })),
        (candidate) => {
          const parsed = parseSsoTestCapture(candidate)
          expect(parsed).not.toBeNull()
          expect(parsed?.replay?.sources.length).toBe(
            (candidate.replay as { sources: unknown[] }).sources.length
          )
        }
      )
    )
  })

  it('V2/V3: one ambiguous source entry anywhere invalidates the whole capture', () => {
    fc.assert(
      fc.property(
        fc.array(genGoodSnapshot(), { minLength: 0, maxLength: 3 }),
        fc.array(genGoodSnapshot(), { minLength: 0, maxLength: 3 }),
        genAmbiguousSnapshot(),
        (before, after, ambiguous) => {
          const value = {
            version: 2,
            registrationId: 'oidc_x',
            capturedAt: '2026-09-07T12:00:00.000Z',
            detailsChangedAtAtStart: null,
            outcome: 'success',
            claims: {},
            replay: { sources: [...before, ambiguous, ...after] },
          }
          expect(parseSsoTestCapture(value)).toBeNull()
        }
      )
    )
  })
})

describe('captureSuggestionClaims', () => {
  it('includes later-source claims the binder omitted from capture.claims', () => {
    const claims = captureSuggestionClaims({
      version: 2,
      registrationId: 'oidc_x',
      capturedAt: '2026-09-07T12:00:00.000Z',
      detailsChangedAtAtStart: null,
      outcome: 'success',
      claims: { sub: 'u1', email: 'a@x.com', name: 'A' },
      replay: {
        sources: [
          { source: 'idToken', claims: { sub: 'u1', email: 'a@x.com', name: 'A' } },
          { source: 'userinfo', claims: { sub: 'u1', groups: ['engineering'] } },
        ],
      },
    })
    expect(claims.groups).toEqual(['engineering'])
    expect(claims.email).toBe('a@x.com')
  })

  it('omits discarded mismatched userinfo from suggestion candidates', () => {
    const claims = captureSuggestionClaims({
      version: 2,
      registrationId: 'oidc_x',
      capturedAt: '2026-09-07T12:00:00.000Z',
      detailsChangedAtAtStart: null,
      outcome: 'success',
      claims: { sub: 'from-token', email: 'a@x.com', name: 'A', groups: ['eng'] },
      replay: {
        sources: [
          {
            source: 'idToken',
            claims: { sub: 'from-token', email: 'a@x.com', name: 'A', groups: ['eng'] },
          },
          {
            source: 'userinfo',
            claims: { sub: 'other-subject', groups: ['ops'], extra: 'only-userinfo' },
          },
        ],
      },
    })
    expect(claims.groups).toEqual(['eng'])
    expect(claims.extra).toBeUndefined()
  })
})
