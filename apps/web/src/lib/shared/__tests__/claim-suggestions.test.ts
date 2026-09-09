import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  deriveAttributeClaimPaths,
  deriveClaimSuggestions,
  deriveIdentityClaimPaths,
  identityClaimHints,
} from '../claim-suggestions'
import type { JsonValue } from '../json'

/**
 * Contract for `claim-suggestions.ts`, confirmed before these tests were
 * written (module doc: "the array-of-string claims (groups/roles) and their
 * distinct values... standard identity claims are never mappable").
 *
 * V1 A standard OIDC/identity claim (iss, sub, aud, exp, iat, nbf, jti, nonce,
 *    azp, at_hash, c_hash, sid, rh, uti, aio, ver, amr, acr, and — for
 *    role/group suggestions specifically — also email/name/preferred_username
 *    /given_name/family_name) is never offered as a role/group-mapping
 *    suggestion, whatever value it carries.
 * V2 Only a claim whose value is a non-empty array containing at least one
 *    non-empty string is ever offered as a role/group-mapping path; a scalar
 *    claim, or an array with no usable string values, never appears as one.
 * V3 A URL-shaped claim key (containing "://") is always treated as one
 *    literal path — never split into a dotted sub-path — and a URL-shaped
 *    CHILD key found inside an ordinary nested object is skipped rather than
 *    producing an unresolvable dotted path.
 * V4 deriveIdentityClaimPaths always offers `sub` as an identity-path
 *    candidate exactly once, and marks an array, boolean, or null claim value
 *    as unsuitable for identity binding rather than silently unwrapping it.
 */

describe('deriveClaimSuggestions', () => {
  it('surfaces a top-level string[] claim as a path with its values', () => {
    const out = deriveClaimSuggestions({ groups: ['admins', 'devs'] })
    expect(out.paths).toEqual(['groups'])
    expect(out.valuesByPath).toEqual({ groups: ['admins', 'devs'] })
  })

  it('finds a nested array claim at depth 2 (Keycloak realm_access.roles)', () => {
    const out = deriveClaimSuggestions({ realm_access: { roles: ['admin'] } })
    expect(out.paths).toEqual(['realm_access.roles'])
    expect(out.valuesByPath['realm_access.roles']).toEqual(['admin'])
  })

  it('records a URL-shaped claim key literally, not split on slashes', () => {
    const out = deriveClaimSuggestions({ 'https://acme.com/roles': ['platform-admins'] })
    expect(out.paths).toEqual(['https://acme.com/roles'])
    expect(out.valuesByPath['https://acme.com/roles']).toEqual(['platform-admins'])
  })

  it('excludes standard identity claims and scalars', () => {
    const out = deriveClaimSuggestions({
      iss: 'https://idp',
      sub: 'u1',
      email: 'a@b.com',
      tid: '6045704a-f241-4b8d-99ba-4f91f4fc2e4b',
      ver: '2.0',
    })
    expect(out.paths).toEqual([])
  })

  it('skips empty arrays and dedupes + filters non-strings, preserving order', () => {
    const out = deriveClaimSuggestions({
      groups: ['a', 'a', 5 as unknown as string, 'b'],
      roles: [],
    })
    expect(out.paths).toEqual(['groups'])
    expect(out.valuesByPath.groups).toEqual(['a', 'b'])
  })
})

describe('deriveAttributeClaimPaths', () => {
  it('includes scalars and arrays, with a truncated value preview', () => {
    const out = deriveAttributeClaimPaths({
      department: 'Engineering',
      groups: ['admins', 'devs'],
    })
    expect(out.map((s) => s.path)).toEqual(['department', 'groups'])
    expect(out.find((s) => s.path === 'department')?.description).toBe('Engineering')
    expect(out.find((s) => s.path === 'groups')?.description).toBe('admins, devs')
  })

  it('walks nested objects to depth 2', () => {
    const out = deriveAttributeClaimPaths({ org: { costCenter: 'cc-1' } })
    expect(out.map((s) => s.path)).toEqual(['org.costCenter'])
    expect(out[0]?.description).toBe('cc-1')
  })

  it('records a URL-shaped key literally', () => {
    const out = deriveAttributeClaimPaths({ 'https://acme.com/plan': 'enterprise' })
    expect(out.map((s) => s.path)).toEqual(['https://acme.com/plan'])
  })

  it('excludes protocol claims and keeps profile claims', () => {
    const out = deriveAttributeClaimPaths({
      iss: 'https://idp',
      sub: 'u1',
      aud: 'cid',
      exp: 1,
      email: 'a@b.com',
      preferred_username: 'alice',
      name: 'Alice',
    })
    const paths = out.map((s) => s.path)
    expect(paths).toEqual(expect.arrayContaining(['email', 'preferred_username', 'name']))
    expect(paths).not.toContain('iss')
    expect(paths).not.toContain('sub')
    expect(paths).not.toContain('aud')
    expect(paths).not.toContain('exp')
  })
})

describe('deriveIdentityClaimPaths', () => {
  it('includes sub among identity suggestions even when attribute suggestions exclude it', () => {
    const claims = {
      iss: 'https://idp',
      sub: 'person-123',
      aud: 'cid',
      email: 'jane@example.test',
      groups: ['engineering'],
    }
    const identity = deriveIdentityClaimPaths(claims)
    const attributes = deriveAttributeClaimPaths(claims)
    expect(identity.map((s) => s.path)).toContain('sub')
    expect(identity.find((s) => s.path === 'sub')?.description).toBe('person-123')
    expect(attributes.map((s) => s.path)).not.toContain('sub')
  })

  it('includes sub when the capture omitted it', () => {
    const identity = deriveIdentityClaimPaths({ email: 'jane@example.test' })
    expect(identity.map((s) => s.path)).toContain('sub')
  })

  it('marks array candidates as unsuitable for identity and does not unwrap them', () => {
    const identity = deriveIdentityClaimPaths({
      sub: 'person-123',
      groups: ['engineering', 'admins'],
    })
    const groups = identity.find((s) => s.path === 'groups')
    expect(groups?.unsuitable).toBe(true)
    expect(groups?.description).toBe('engineering, admins')
    expect(identity.map((s) => s.path)).not.toContain('groups.0')
  })

  it('marks boolean and null identity leaves as unsuitable', () => {
    const identity = deriveIdentityClaimPaths({
      sub: 'person-123',
      email_verified: true,
      department: null,
      employee_id: 42,
    })
    expect(identity.find((s) => s.path === 'email_verified')?.unsuitable).toBe(true)
    expect(identity.find((s) => s.path === 'department')?.unsuitable).toBe(true)
    expect(identity.find((s) => s.path === 'employee_id')?.unsuitable).toBeUndefined()
  })

  it('offers entra aliases as suggestions without rewriting captured paths', () => {
    const identity = deriveIdentityClaimPaths({ sub: 's-1', email: 'a@b.test' }, { kind: 'entra' })
    const paths = identity.map((s) => s.path)
    expect(paths).toEqual(expect.arrayContaining(['sub', 'oid', 'upn', 'email']))
    expect(identityClaimHints('entra', 'id')).toEqual(['oid', 'sub'])
    expect(identityClaimHints('entra', 'email')).toEqual(['email', 'upn', 'preferred_username'])
  })

  it('a URL-shaped top-level key is recorded as one literal identity path (V3)', () => {
    const identity = deriveIdentityClaimPaths({
      sub: 'person-123',
      'https://schemas.example.com/identity/claims/employeeid': 'E-123',
    })
    const entry = identity.find(
      (s) => s.path === 'https://schemas.example.com/identity/claims/employeeid'
    )
    expect(entry).toBeDefined()
    expect(entry?.description).toBe('E-123')
    expect(entry?.unsuitable).toBeUndefined()
  })

  it('a nested object records ordinary children as dotted paths and skips URL-shaped children (V3)', () => {
    const identity = deriveIdentityClaimPaths({
      sub: 'person-123',
      realm_access: {
        roles: ['engineering'],
        'https://ns.example.com/skip': 'should-not-appear',
      },
    })
    const paths = identity.map((s) => s.path)
    expect(paths).toContain('realm_access.roles')
    expect(identity.find((s) => s.path === 'realm_access.roles')?.unsuitable).toBe(true)
    expect(paths.some((p) => p.includes('skip'))).toBe(false)
    expect(paths).not.toContain('realm_access.https://ns.example.com/skip')
  })
})

describe('property-based tests (fast-check)', () => {
  const STANDARD_OIDC_PROTOCOL_CLAIMS = [
    'iss',
    'aud',
    'exp',
    'iat',
    'nbf',
    'jti',
    'nonce',
    'azp',
    'at_hash',
    'c_hash',
    'sid',
    'rh',
    'uti',
    'aio',
    'ver',
    'amr',
    'acr',
  ]
  const STANDARD_ROLE_MAPPING_CLAIMS = [
    ...STANDARD_OIDC_PROTOCOL_CLAIMS,
    'sub',
    'email',
    'email_verified',
    'name',
    'preferred_username',
    'given_name',
    'family_name',
  ]

  const arrayValue = fc.array(fc.string({ minLength: 1, maxLength: 10 }), {
    minLength: 1,
    maxLength: 4,
  })

  it('V1: a standard claim never becomes a role/group suggestion, however array-shaped its value', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STANDARD_ROLE_MAPPING_CLAIMS),
        arrayValue,
        (claimKey, value) => {
          const out = deriveClaimSuggestions({ [claimKey]: value })
          expect(out.paths).not.toContain(claimKey)
        }
      )
    )
  })

  it('V2: only a non-empty array of non-empty strings becomes a role/group suggestion', () => {
    const nonArrayValue: fc.Arbitrary<JsonValue> = fc.oneof(
      fc.string(),
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      fc.array(fc.integer(), { maxLength: 3 }),
      fc.constant<JsonValue[]>([])
    )
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 12 })
          .filter(
            (k) =>
              !STANDARD_ROLE_MAPPING_CLAIMS.includes(k) && !k.includes('://') && !k.includes('.')
          ),
        fc.oneof(arrayValue, nonArrayValue),
        (key, value) => {
          const out = deriveClaimSuggestions({ [key]: value })
          const isUsableArray =
            Array.isArray(value) && value.some((v) => typeof v === 'string' && v !== '')
          if (isUsableArray) {
            expect(out.paths).toContain(key)
          } else {
            expect(out.paths).not.toContain(key)
          }
        }
      )
    )
  })

  it('V3: a URL-shaped key is recorded literally and never split into a dotted sub-path', () => {
    fc.assert(
      fc.property(fc.webUrl(), arrayValue, (url, value) => {
        const out = deriveClaimSuggestions({ [url]: value })
        expect(out.paths).toContain(url)
        expect(out.paths.some((p) => p !== url && p.startsWith(`${url}.`))).toBe(false)
      })
    )
  })

  it('V4: sub is always offered as an identity candidate, and arrays/booleans/null are marked unsuitable', () => {
    const leafValue = fc.oneof(
      fc.string({ minLength: 1, maxLength: 10 }),
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      arrayValue
    )
    fc.assert(
      fc.property(
        fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
        leafValue,
        (subValue, otherClaimValue) => {
          const claims: Record<string, JsonValue> = subValue === undefined ? {} : { sub: subValue }
          claims.other_claim = otherClaimValue
          const identity = deriveIdentityClaimPaths(claims)
          const subEntry = identity.find((s) => s.path === 'sub')
          expect(subEntry).toBeDefined()
          if (subValue === undefined) {
            expect(subEntry?.description).toBeUndefined()
          } else {
            expect(subEntry?.description).toBe(subValue)
          }
          const otherEntry = identity.find((s) => s.path === 'other_claim')
          const shouldBeUnsuitable =
            Array.isArray(otherClaimValue) ||
            typeof otherClaimValue === 'boolean' ||
            otherClaimValue === null
          expect(Boolean(otherEntry?.unsuitable)).toBe(shouldBeUnsuitable)
        }
      )
    )
  })
})
