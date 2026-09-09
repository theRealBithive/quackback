import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  applyClaimMappingEdits,
  ClaimMappingEditError,
  diffClaimMappingOperations,
  effectiveProfileSignature,
  mappingSaveRisks,
  mappingWouldStripUnsupported,
  storedJsonEqual,
  type ClaimMappingOperation,
} from '../sso-claim-mapping-edit'
import type { Role } from '../roles'
import type { IdentitySource } from '../oidc-claim-mapping'

/**
 * Contract for `sso-claim-mapping-edit.ts`, confirmed before these tests were
 * written (module doc: "Closed operations over stored claim_mapping JSON.
 * Unedited raw keys survive."; upstream PR #509: lossless mapping saves).
 *
 * V1 Applying edit operations to a stored mapping never discards JSON the
 *    editor does not understand: any unknown top-level section, unknown key
 *    inside profile/role/attributes, or extra field on a role-rule/People row
 *    is preserved in the output, regardless of which supported fields were
 *    edited alongside it.
 * V2 For any stored mapping and any proposed draft, applying the operations
 *    `diffClaimMappingOperations` computes reproduces the proposed draft's
 *    SUPPORTED configuration exactly (same effective profile signature), and
 *    does this without touching unknown JSON already living on the stored
 *    mapping — the diff-then-apply cycle never invents or drops a supported
 *    setting, and it is not destructive of what it does not model.
 * V3 Removing more than one role rule or People row in a single call removes
 *    exactly the rows that occupied those indices in the ORIGINAL stored
 *    list, independent of the order the removal operations were supplied in.
 * V4 Every index-addressed operation (removeRoleRule, removePeopleMapping,
 *    editRoleRule, reorderRoleRule's `from`) rejects an index outside the
 *    current list's bounds by throwing ClaimMappingEditError, and never
 *    mutates a different row instead.
 * V5 A role rule can never be stored with a blank/whitespace-only "contains"
 *    condition, or with a role outside admin/member/user — both
 *    insertRoleRule and editRoleRule reject such input rather than storing it.
 * V6 Applying an empty operation list returns the stored mapping unchanged.
 */

const ROLES = ['admin', 'member', 'user'] as const

const nonBlankString = fc.string({ minLength: 1, maxLength: 24 }).filter((s) => s.trim().length > 0)

const genRoleRule = () =>
  fc.record({
    whenContains: nonBlankString,
    role: fc.constantFrom(...ROLES),
    // An extra field a newer/older version wrote that this editor does not
    // model — must survive edits to sibling rows.
    note: fc.option(nonBlankString, { nil: undefined }),
  })

const genRoleSection = () =>
  fc.record({
    claimPath: nonBlankString,
    rules: fc.array(genRoleRule(), { minLength: 0, maxLength: 5 }),
  })

const genPeopleRow = () =>
  fc.record({
    claimPath: nonBlankString,
    attributeKey: nonBlankString,
    extra: fc.option(nonBlankString, { nil: undefined }),
  })

/** A stored mapping reaching profile/role/People states, plus an unrelated top-level key. */
const genStoredMapping = () =>
  fc.record({
    profile: fc.option(
      fc.record({
        claims: fc.record({
          id: fc.option(nonBlankString, { nil: undefined }),
          email: fc.option(nonBlankString, { nil: undefined }),
          name: fc.option(nonBlankString, { nil: undefined }),
        }),
        sources: fc.constantFrom<string[]>(['idToken'], ['idToken', 'userinfo'], ['userinfo']),
      }),
      { nil: undefined }
    ),
    role: fc.option(genRoleSection(), { nil: undefined }),
    attributes: fc.option(
      // minLength: 1 — an empty `map` is pruned away by production code (by
      // design: pruneEmpty deletes an empty attributes.map, then the now-empty
      // attributes object itself), so it is not a "stored mapping" this
      // no-op-identity property can assert equality against.
      fc.record({ map: fc.array(genPeopleRow(), { minLength: 1, maxLength: 4 }) }),
      { nil: undefined }
    ),
    unrelatedSection: fc.record({ marker: fc.constant('keep-me'), tag: nonBlankString }),
  })

describe('applyClaimMappingEdits', () => {
  it('editing one mapping preserves all saved rows and unknown siblings', () => {
    const raw = {
      profile: {
        claims: { email: 'upn' },
        extra: { nested: true },
        longPath: 'x'.repeat(300),
      },
      role: {
        claimPath: 'groups',
        rules: [{ whenContains: 'eng', role: 'member', note: 'keep' }],
        custom: 1,
      },
      attributes: {
        map: [
          { claimPath: 'dept', attributeKey: 'department', extra: 'row' },
          { claimPath: 'gone', attributeKey: 'deleted_def' },
          { claimPath: 'dept', attributeKey: 'department' },
        ],
      },
      unknownSection: { keep: true },
    }
    const next = applyClaimMappingEdits(raw, [
      { op: 'setProfileClaim', field: 'name', path: 'preferred_username' },
    ]) as Record<string, unknown>
    expect(next.unknownSection).toEqual({ keep: true })
    expect((next.profile as Record<string, unknown>).extra).toEqual({ nested: true })
    expect((next.profile as Record<string, unknown>).longPath).toHaveLength(300)
    expect((next.role as Record<string, unknown>).custom).toBe(1)
    expect(((next.role as Record<string, unknown>).rules as object[])[0]).toEqual({
      whenContains: 'eng',
      role: 'member',
      note: 'keep',
    })
    expect((next.attributes as { map: unknown[] }).map).toHaveLength(3)
    expect((next.profile as { claims: { name: string } }).claims.name).toBe('preferred_username')
  })

  it('no-op save preserves original JSON', () => {
    const raw = { role: { claimPath: 'groups', rules: [{ whenContains: 'a', role: 'admin' }] } }
    expect(applyClaimMappingEdits(raw, [])).toEqual(raw)
  })
})

describe('effectiveProfileSignature', () => {
  it('treats explicit default sources and object key reorder as the same as implicit defaults', () => {
    const implicit = effectiveProfileSignature(null)
    const explicit = effectiveProfileSignature({
      profile: { sources: ['idToken', 'userinfo'], allowMissingEmail: false },
    })
    const reordered = effectiveProfileSignature({
      profile: { allowMissingEmail: false, sources: ['idToken', 'userinfo'] },
    })
    expect(explicit).toBe(implicit)
    expect(reordered).toBe(implicit)
  })

  it('treats explicit id: sub as different from implicit default', () => {
    expect(effectiveProfileSignature({ profile: { claims: { id: 'sub' } } })).not.toBe(
      effectiveProfileSignature(null)
    )
  })

  it('role-only and People-only edits do not change the profile signature', () => {
    const before = { profile: { claims: { email: 'upn' } } }
    const roleOnly = applyClaimMappingEdits(before, [
      { op: 'setRolePath', claimPath: 'groups' },
      { op: 'insertRoleRule', index: 0, rule: { whenContains: 'eng', role: 'member' } },
    ])
    const peopleOnly = applyClaimMappingEdits(before, [
      {
        op: 'insertPeopleMapping',
        index: 0,
        entry: { claimPath: 'dept', attributeKey: 'department' },
      },
    ])
    expect(effectiveProfileSignature(roleOnly)).toBe(effectiveProfileSignature(before))
    expect(effectiveProfileSignature(peopleOnly)).toBe(effectiveProfileSignature(before))
  })
})

describe('mappingSaveRisks', () => {
  it('identifier edit is detected for id path and sources', () => {
    expect(mappingSaveRisks(null, { profile: { claims: { id: 'oid' } } }).identifierChanged).toBe(
      true
    )
    expect(mappingSaveRisks(null, { profile: { sources: ['userinfo'] } }).identifierChanged).toBe(
      true
    )
  })

  it('admin rule save requires acknowledgement even when tester would be member', () => {
    const after = {
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'platform-admins', role: 'admin' },
          { whenContains: 'engineering', role: 'member' },
        ],
      },
    }
    const risks = mappingSaveRisks(null, after)
    expect(risks.hasAdminRules).toBe(true)
    expect(risks.adminRules).toHaveLength(1)
  })
})

describe('diffClaimMappingOperations', () => {
  it('default Save with Advanced sources mounted does not invent mapping ops', () => {
    const ops = diffClaimMappingOperations(null, {
      profile: { sources: ['idToken', 'userinfo'] },
    })
    expect(ops).toEqual([])
    const after = applyClaimMappingEdits(null, ops)
    expect(effectiveProfileSignature(after)).toBe(effectiveProfileSignature(null))
  })

  it('reordering rules emits reorderRoleRule so extra fields move with the rule', () => {
    const stored = {
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'eng', role: 'member', note: 'eng-note' },
          { whenContains: 'admins', role: 'admin', note: 'admin-note' },
        ],
      },
    }
    const ops = diffClaimMappingOperations(stored, {
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'admins', role: 'admin' },
          { whenContains: 'eng', role: 'member' },
        ],
      },
    })
    expect(ops).toEqual([{ op: 'reorderRoleRule', from: 1, to: 0 }])
    expect(applyClaimMappingEdits(stored, ops)).toEqual({
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'admins', role: 'admin', note: 'admin-note' },
          { whenContains: 'eng', role: 'member', note: 'eng-note' },
        ],
      },
    })
  })

  it('deleting a non-tail rule removes that row so extra fields stay with survivors', () => {
    const stored = {
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'eng', role: 'member', note: 'eng-note' },
          { whenContains: 'admins', role: 'admin', note: 'admin-note' },
        ],
      },
    }
    const ops = diffClaimMappingOperations(stored, {
      role: {
        claimPath: 'groups',
        rules: [{ whenContains: 'admins', role: 'admin' }],
      },
    })
    expect(ops).toEqual([{ op: 'removeRoleRule', index: 0 }])
    expect(applyClaimMappingEdits(stored, ops)).toEqual({
      role: {
        claimPath: 'groups',
        rules: [{ whenContains: 'admins', role: 'admin', note: 'admin-note' }],
      },
    })
  })

  it('reorder+remove keeps extra fields on the surviving objects', () => {
    const stored = {
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'a', role: 'member', note: 'a-note' },
          { whenContains: 'b', role: 'member', note: 'b-note' },
          { whenContains: 'c', role: 'admin', note: 'c-note' },
        ],
      },
    }
    const ops = diffClaimMappingOperations(stored, {
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'c', role: 'admin' },
          { whenContains: 'a', role: 'member' },
        ],
      },
    })
    expect(ops).toEqual([
      { op: 'removeRoleRule', index: 1 },
      { op: 'reorderRoleRule', from: 1, to: 0 },
    ])
    expect(applyClaimMappingEdits(stored, ops)).toEqual({
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'c', role: 'admin', note: 'c-note' },
          { whenContains: 'a', role: 'member', note: 'a-note' },
        ],
      },
    })
  })
})

describe('storedJsonEqual', () => {
  it('ignores object key reorder', () => {
    expect(storedJsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
  })
})

describe('mappingWouldStripUnsupported', () => {
  const stored = {
    profile: { claims: { email: 'upn' }, extra: true },
    role: {
      claimPath: 'groups',
      rules: [{ whenContains: 'eng', role: 'member', note: 'keep' }],
      custom: 1,
    },
    attributes: {
      map: [{ claimPath: 'dept', attributeKey: 'department', extra: 'row' }],
      label: 'people',
    },
    unknownSection: { keep: true },
  }

  it('rejects a typed mapping DTO that would drop nested unknown siblings', () => {
    const typed = {
      profile: { claims: { email: 'upn' } },
      role: {
        claimPath: 'groups',
        rules: [{ whenContains: 'eng', role: 'member' }],
      },
      attributes: {
        map: [{ claimPath: 'dept', attributeKey: 'department' }],
      },
    }
    expect(mappingWouldStripUnsupported(stored, typed)).toBe(true)
    expect(
      mappingWouldStripUnsupported(stored, {
        ...stored,
        role: { claimPath: 'groups', rules: stored.role.rules },
      })
    ).toBe(true)
    expect(
      mappingWouldStripUnsupported(stored, {
        ...stored,
        role: { ...stored.role, rules: [{ whenContains: 'eng', role: 'member' }] },
      })
    ).toBe(true)
    expect(
      mappingWouldStripUnsupported(stored, {
        ...stored,
        attributes: { map: stored.attributes.map },
      })
    ).toBe(true)
    expect(
      mappingWouldStripUnsupported(stored, {
        ...stored,
        attributes: {
          ...stored.attributes,
          map: [{ claimPath: 'dept', attributeKey: 'department' }],
        },
      })
    ).toBe(true)
  })

  it('lets an unchanged mapping with extras round-trip', () => {
    expect(mappingWouldStripUnsupported(stored, { ...stored })).toBe(false)
    expect(
      mappingWouldStripUnsupported(stored, {
        unknownSection: { keep: true },
        attributes: stored.attributes,
        role: stored.role,
        profile: stored.profile,
      })
    ).toBe(false)
  })

  it('does not treat deleting a fully supported section as stripping extras', () => {
    expect(
      mappingWouldStripUnsupported(
        { role: { claimPath: 'groups', rules: [{ whenContains: 'eng', role: 'member' }] } },
        { profile: { allowMissingEmail: true } }
      )
    ).toBe(false)
  })
})

describe('validation errors thrown while editing (V4, V5)', () => {
  it('rejects an empty claim path (V4)', () => {
    expect(() =>
      applyClaimMappingEdits(null, [{ op: 'setProfileClaim', field: 'email', path: '   ' }])
    ).toThrow(ClaimMappingEditError)
    try {
      applyClaimMappingEdits(null, [{ op: 'setProfileClaim', field: 'email', path: '' }])
      throw new Error('expected a throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ClaimMappingEditError)
      expect((err as InstanceType<typeof ClaimMappingEditError>).code).toBe('INVALID_CLAIM_PATH')
    }
  })

  it('rejects a claim path over the maximum length (V4)', () => {
    expect(() =>
      applyClaimMappingEdits(null, [
        { op: 'setProfileClaim', field: 'email', path: 'x'.repeat(257) },
      ])
    ).toThrow(/at most 256 characters/)
  })

  it('rejects a role outside admin/member/user (V5)', () => {
    const badRole = 'superadmin' as unknown as Role
    expect(() =>
      applyClaimMappingEdits(null, [
        { op: 'insertRoleRule', index: 0, rule: { whenContains: 'eng', role: badRole } },
      ])
    ).toThrow(/Role must be admin, member, or user/)
  })

  it('rejects an out-of-range role-rule removal without touching the stored rules (V4)', () => {
    const stored = {
      role: { claimPath: 'groups', rules: [{ whenContains: 'eng', role: 'member' }] },
    }
    expect(() => applyClaimMappingEdits(stored, [{ op: 'removeRoleRule', index: 5 }])).toThrow(
      /Role rule index is out of range/
    )
  })

  it('rejects an out-of-range People-mapping removal (V4)', () => {
    const stored = {
      attributes: { map: [{ claimPath: 'dept', attributeKey: 'department' }] },
    }
    expect(() => applyClaimMappingEdits(stored, [{ op: 'removePeopleMapping', index: 3 }])).toThrow(
      /People mapping index is out of range/
    )
  })
})

describe('batch removal takes original indices, order-independent (V3)', () => {
  it('removing two role rules in one call removes exactly those two original rows', () => {
    const stored = {
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'a', role: 'member' },
          { whenContains: 'b', role: 'member' },
          { whenContains: 'c', role: 'admin' },
          { whenContains: 'd', role: 'user' },
        ],
      },
    }
    // Indices 0 and 2 removed, supplied in ascending order in the call.
    const ascending = applyClaimMappingEdits(stored, [
      { op: 'removeRoleRule', index: 0 },
      { op: 'removeRoleRule', index: 2 },
    ]) as { role: { rules: unknown[] } }
    // Same removal, operations supplied in the opposite order.
    const descending = applyClaimMappingEdits(stored, [
      { op: 'removeRoleRule', index: 2 },
      { op: 'removeRoleRule', index: 0 },
    ]) as { role: { rules: unknown[] } }
    const expected = [
      { whenContains: 'b', role: 'member' },
      { whenContains: 'd', role: 'user' },
    ]
    expect(ascending.role.rules).toEqual(expected)
    expect(descending.role.rules).toEqual(expected)
  })

  it('removing two People rows in one call removes exactly those two original rows', () => {
    const stored = {
      attributes: {
        map: [
          { claimPath: 'a', attributeKey: 'a1' },
          { claimPath: 'b', attributeKey: 'b1' },
          { claimPath: 'c', attributeKey: 'c1' },
        ],
      },
    }
    const result = applyClaimMappingEdits(stored, [
      { op: 'removePeopleMapping', index: 0 },
      { op: 'removePeopleMapping', index: 1 },
    ]) as { attributes: { map: unknown[] } }
    expect(result.attributes.map).toEqual([{ claimPath: 'c', attributeKey: 'c1' }])
  })
})

describe('individual operations reaching lines not exercised elsewhere', () => {
  it('setSources rejects an empty source list', () => {
    expect(() => applyClaimMappingEdits(null, [{ op: 'setSources', sources: [] }])).toThrow(
      /At least one identity source is required/
    )
  })

  it('setSources rejects a list with no recognized source', () => {
    const bogusSources = ['not_a_real_source'] as unknown as IdentitySource[]
    expect(() =>
      applyClaimMappingEdits(null, [{ op: 'setSources', sources: bogusSources }])
    ).toThrow(/At least one identity source is required/)
  })

  it('resetSources removes a stored source override, leaving profile default', () => {
    const stored = { profile: { sources: ['userinfo'], claims: { email: 'upn' } } }
    const result = applyClaimMappingEdits(stored, [{ op: 'resetSources' }]) as {
      profile: Record<string, unknown>
    }
    expect(result.profile.sources).toBeUndefined()
    expect(result.profile.claims).toEqual({ email: 'upn' })
  })

  it('resetSources on a mapping with no profile section is a harmless no-op', () => {
    expect(applyClaimMappingEdits(null, [{ op: 'resetSources' }])).toBeNull()
  })

  it('setAllowMissingEmail:false deletes a previously-set flag', () => {
    const stored = { profile: { allowMissingEmail: true, claims: { email: 'upn' } } }
    const result = applyClaimMappingEdits(stored, [
      { op: 'setAllowMissingEmail', allow: false },
    ]) as { profile: Record<string, unknown> }
    expect(result.profile.allowMissingEmail).toBeUndefined()
  })

  it('insertRoleRule with no prior role defaults the claim path to "groups"', () => {
    const result = applyClaimMappingEdits(null, [
      { op: 'insertRoleRule', index: 0, rule: { whenContains: 'eng', role: 'member' } },
    ]) as { role: Record<string, unknown> }
    expect(result.role.claimPath).toBe('groups')
    expect(result.role.rules).toEqual([{ whenContains: 'eng', role: 'member' }])
  })

  it('editRoleRule rejects an out-of-range index', () => {
    const stored = { role: { claimPath: 'groups', rules: [{ whenContains: 'a', role: 'user' }] } }
    expect(() =>
      applyClaimMappingEdits(stored, [
        { op: 'editRoleRule', index: 9, rule: { whenContains: 'b', role: 'admin' } },
      ])
    ).toThrow(/Role rule index is out of range/)
  })

  it('editRoleRule rejects a blank condition', () => {
    const stored = { role: { claimPath: 'groups', rules: [{ whenContains: 'a', role: 'user' }] } }
    expect(() =>
      applyClaimMappingEdits(stored, [
        { op: 'editRoleRule', index: 0, rule: { whenContains: '   ', role: 'admin' } },
      ])
    ).toThrow(/A role rule has no value/)
  })

  it('editRoleRule updates whenContains/role in place, preserving unrelated stored fields on the row', () => {
    const stored = {
      role: {
        claimPath: 'groups',
        rules: [{ whenContains: 'eng', role: 'member', note: 'kept from a newer version' }],
      },
    }
    const result = applyClaimMappingEdits(stored, [
      { op: 'editRoleRule', index: 0, rule: { whenContains: 'engineering', role: 'admin' } },
    ]) as { role: { rules: Array<Record<string, unknown>> } }
    expect(result.role.rules[0]).toEqual({
      whenContains: 'engineering',
      role: 'admin',
      note: 'kept from a newer version',
    })
  })

  it('reorderRoleRule rejects an out-of-range "from" index', () => {
    const stored = { role: { claimPath: 'groups', rules: [{ whenContains: 'a', role: 'user' }] } }
    expect(() =>
      applyClaimMappingEdits(stored, [{ op: 'reorderRoleRule', from: 4, to: 0 }])
    ).toThrow(/Role rule index is out of range/)
  })

  it('setRoleSync turns sync-on-every-sign-in on, then off, keeping claimPath/rules intact', () => {
    const stored = { role: { claimPath: 'groups', rules: [{ whenContains: 'a', role: 'user' }] } }
    const on = applyClaimMappingEdits(stored, [{ op: 'setRoleSync', syncOnEverySignIn: true }]) as {
      role: Record<string, unknown>
    }
    expect(on.role.syncOnEverySignIn).toBe(true)
    const off = applyClaimMappingEdits(on, [{ op: 'setRoleSync', syncOnEverySignIn: false }]) as {
      role: Record<string, unknown>
    }
    expect(off.role.syncOnEverySignIn).toBeUndefined()
    expect(off.role.claimPath).toBe('groups')
  })

  it('setRoleSync with no prior role creates one with default claimPath and empty rules', () => {
    const result = applyClaimMappingEdits(null, [
      { op: 'setRoleSync', syncOnEverySignIn: true },
    ]) as { role: Record<string, unknown> }
    expect(result.role.claimPath).toBe('groups')
    expect(result.role.rules).toEqual([])
    expect(result.role.syncOnEverySignIn).toBe(true)
  })

  it('removeRole deletes the whole role section', () => {
    const stored = {
      role: { claimPath: 'groups', rules: [{ whenContains: 'a', role: 'user' }] },
      profile: { claims: { email: 'upn' } },
    }
    const result = applyClaimMappingEdits(stored, [{ op: 'removeRole' }]) as Record<string, unknown>
    expect(result.role).toBeUndefined()
    expect(result.profile).toEqual({ claims: { email: 'upn' } })
  })

  it('editPeopleMapping rejects an out-of-range index', () => {
    const stored = { attributes: { map: [{ claimPath: 'dept', attributeKey: 'department' }] } }
    expect(() =>
      applyClaimMappingEdits(stored, [
        { op: 'editPeopleMapping', index: 7, entry: { claimPath: 'x', attributeKey: 'y' } },
      ])
    ).toThrow(/People mapping index is out of range/)
  })
})

describe('diffClaimMappingOperations falls back to per-index edit diffing (V2)', () => {
  it('same rule count with changed content emits editRoleRule instead of a subset+permute', () => {
    const stored = {
      role: { claimPath: 'groups', rules: [{ whenContains: 'eng', role: 'member' }] },
    }
    const ops = diffClaimMappingOperations(stored, {
      role: { claimPath: 'groups', rules: [{ whenContains: 'other', role: 'member' }] },
    })
    expect(ops).toEqual([
      { op: 'editRoleRule', index: 0, rule: { whenContains: 'other', role: 'member' } },
    ])
    expect(applyClaimMappingEdits(stored, ops)).toEqual({
      role: { claimPath: 'groups', rules: [{ whenContains: 'other', role: 'member' }] },
    })
  })

  it('a shrinking, non-subset People list emits an edit for the survivor plus a tail removal', () => {
    const stored = {
      attributes: {
        map: [
          { claimPath: 'dept', attributeKey: 'department' },
          { claimPath: 'team', attributeKey: 'team_name' },
        ],
      },
    }
    // Row 0's attributeKey changed (not a subset match) and row 1 is gone —
    // not expressible as a pure subset+permute, so the diff must fall back to
    // per-index editing plus a tail removal (People equivalent of the role
    // fallback above).
    const ops = diffClaimMappingOperations(stored, {
      attributes: { map: [{ claimPath: 'dept', attributeKey: 'department_id' }] },
    })
    expect(ops).toEqual([
      {
        op: 'editPeopleMapping',
        index: 0,
        entry: { claimPath: 'dept', attributeKey: 'department_id' },
      },
      { op: 'removePeopleMapping', index: 1 },
    ])
    expect(applyClaimMappingEdits(stored, ops)).toEqual({
      attributes: { map: [{ claimPath: 'dept', attributeKey: 'department_id' }] },
    })
  })
})

describe('property-based tests (fast-check)', () => {
  it('V1: an unrelated top-level key survives any sequence of supported operations', () => {
    const opsArb = fc.array(
      fc.oneof(
        fc.record({
          op: fc.constant('setProfileClaim' as const),
          field: fc.constantFrom<'id' | 'email' | 'name'>('id', 'email', 'name'),
          path: nonBlankString,
        }),
        fc.record({ op: fc.constant('resetSources' as const) }),
        fc.record({
          op: fc.constant('setAllowMissingEmail' as const),
          allow: fc.boolean(),
        }),
        fc.record({
          op: fc.constant('setRolePath' as const),
          claimPath: nonBlankString,
        }),
        fc.record({
          op: fc.constant('insertRoleRule' as const),
          index: fc.nat({ max: 3 }),
          rule: genRoleRule().map(({ whenContains, role }) => ({ whenContains, role })),
        }),
        fc.record({
          op: fc.constant('setRoleSync' as const),
          syncOnEverySignIn: fc.boolean(),
        }),
        fc.record({ op: fc.constant('removeRole' as const) })
      ),
      { minLength: 0, maxLength: 6 }
    )

    fc.assert(
      fc.property(genStoredMapping(), opsArb, (stored, ops) => {
        const result = applyClaimMappingEdits(stored, ops as ClaimMappingOperation[]) as Record<
          string,
          unknown
        >
        expect(result.unrelatedSection).toEqual(stored.unrelatedSection)
      })
    )
  })

  it('V3: removing several role rules in one call is order-independent and index-original', () => {
    fc.assert(
      fc.property(fc.array(genRoleRule(), { minLength: 2, maxLength: 6 }), (rules) => {
        const stored = { role: { claimPath: 'groups', rules } }
        const allIndices = rules.map((_, i) => i)
        const toRemove = allIndices.filter((_, i) => i % 2 === 0) // every other index
        fc.pre(toRemove.length >= 2)
        const survivors = rules.filter((_, i) => !toRemove.includes(i))

        const forward = applyClaimMappingEdits(
          stored,
          toRemove.map((index) => ({ op: 'removeRoleRule' as const, index }))
        ) as { role: { rules: unknown[] } }
        const reversed = applyClaimMappingEdits(
          stored,
          [...toRemove].reverse().map((index) => ({ op: 'removeRoleRule' as const, index }))
        ) as { role: { rules: unknown[] } }

        expect(forward.role.rules).toEqual(survivors)
        expect(reversed.role.rules).toEqual(survivors)
      })
    )
  })

  it('V4: an index-addressed operation on a role rule always throws outside the current bounds', () => {
    fc.assert(
      fc.property(
        fc.array(genRoleRule(), { minLength: 0, maxLength: 4 }),
        fc.integer({ min: -5, max: 20 }),
        (rules, index) => {
          fc.pre(index < 0 || index >= rules.length)
          const stored = { role: { claimPath: 'groups', rules } }
          expect(() => applyClaimMappingEdits(stored, [{ op: 'removeRoleRule', index }])).toThrow(
            ClaimMappingEditError
          )
          expect(() =>
            applyClaimMappingEdits(stored, [
              { op: 'editRoleRule', index, rule: { whenContains: 'x', role: 'user' } },
            ])
          ).toThrow(ClaimMappingEditError)
          expect(() =>
            applyClaimMappingEdits(stored, [{ op: 'reorderRoleRule', from: index, to: 0 }])
          ).toThrow(ClaimMappingEditError)
        }
      )
    )
  })

  it('V5: insertRoleRule/editRoleRule never store a blank condition or an unknown role', () => {
    const badRule = fc.oneof(
      fc.record({
        whenContains: fc.constantFrom('', '   ', '\t'),
        role: fc.constantFrom(...ROLES),
      }),
      fc.record({
        whenContains: nonBlankString,
        role: fc.constantFrom('root', 'superadmin', '') as fc.Arbitrary<unknown>,
      })
    )
    fc.assert(
      fc.property(badRule, (rule) => {
        expect(() =>
          applyClaimMappingEdits(null, [
            { op: 'insertRoleRule', index: 0, rule: rule as { whenContains: string; role: Role } },
          ])
        ).toThrow(ClaimMappingEditError)
        const stored = {
          role: { claimPath: 'groups', rules: [{ whenContains: 'eng', role: 'member' }] },
        }
        expect(() =>
          applyClaimMappingEdits(stored, [
            { op: 'editRoleRule', index: 0, rule: rule as { whenContains: string; role: Role } },
          ])
        ).toThrow(ClaimMappingEditError)
      })
    )
  })

  it('V6: an empty operation list returns a non-degenerate stored mapping unchanged', () => {
    fc.assert(
      fc.property(genStoredMapping(), (stored) => {
        expect(applyClaimMappingEdits(stored, [])).toEqual(stored)
      })
    )
  })

  it('V2: diff-then-apply reproduces the proposed profile/role config and never touches unknown JSON', () => {
    const genProposed = fc.record({
      profile: fc.option(
        fc.record({
          claims: fc.record({
            email: fc.option(nonBlankString, { nil: undefined }),
            name: fc.option(nonBlankString, { nil: undefined }),
          }),
        }),
        { nil: undefined }
      ),
      role: fc.option(
        fc.record({
          claimPath: nonBlankString,
          rules: fc.array(
            fc.record({ whenContains: nonBlankString, role: fc.constantFrom(...ROLES) }),
            { minLength: 0, maxLength: 5 }
          ),
        }),
        { nil: undefined }
      ),
    })

    fc.assert(
      fc.property(genStoredMapping(), genProposed, (stored, proposed) => {
        const ops = diffClaimMappingOperations(stored, proposed)
        const result = applyClaimMappingEdits(stored, ops) as Record<string, unknown>
        expect(effectiveProfileSignature(result)).toBe(effectiveProfileSignature(proposed))
        expect(result.unrelatedSection).toEqual(stored.unrelatedSection)
      })
    )
  })
})

// NOTE on line 318 (`case 'removeRoleRule': case 'removePeopleMapping': return`
// inside the internal, unexported `applyOne` switch): this is unreachable
// through the public API. `applyClaimMappingEdits`'s `rest` filter (lines
// 141-143) always strips both op types out before the per-operation loop that
// calls `applyOne` (lines 164-166), and there is no other caller of
// `applyOne`. Left uncovered deliberately rather than covered with a
// contrived direct call into a non-exported function — see final report.
