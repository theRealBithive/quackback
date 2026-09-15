/**
 * Contract group R (contract-c.md), copied verbatim:
 *
 * ## R — Permissions mirror
 * - R1 The client-safe permissions file is exactly what the generator renders from
 *   the catalogue, byte for byte. (Upstream's drift test, kept.)
 * - R2 The rendered mirror lists permissions in catalogue order, grouped under
 *   their category, and the role presets refer to permissions by name — a
 *   permission added to the catalogue appears in the mirror with its category
 *   without hand edits.
 * - R3 A catalogue inconsistency — a permission value without a name, or without
 *   a category — stops the generator with an error naming the value instead of
 *   rendering a file with a hole.
 *
 * R1 is already pinned byte-for-byte by
 * apps/web/src/lib/shared/__tests__/permissions-catalogue-drift.test.ts and is not
 * duplicated here. This suite covers R2 (against the real catalogue) and R3
 * (against a deliberately broken one). R3 uses `vi.doMock` + `vi.resetModules()` +
 * a dynamic import inside each test, exactly so the broken catalogue never leaks
 * into a statically-imported module used by R2's assertions.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import {
  PERMISSIONS,
  PERMISSION_CATALOGUE,
  PERMISSION_CATEGORIES,
  WORKSPACE_ADMIN_PERMISSIONS,
  SYSTEM_ROLE_PERMISSIONS,
} from '../rbac-catalogue'
import { renderPermissionsMirror } from '../permissions-mirror'

describe('R2 — rendered mirror order and references', () => {
  // Built in beforeAll, not at describe-body scope: calling production code
  // while vitest collects tests (rather than while a test runs) is what makes a
  // crash during collection score as "survived" instead of "erred" under Stryker
  // (SELF-IMPROVE.md, "Stryker runs the whole suite first...").
  let rendered = ''
  beforeAll(() => {
    rendered = renderPermissionsMirror()
  })

  const nameByValue = new Map(Object.entries(PERMISSIONS).map(([name, value]) => [value, name]))
  const categoryByValue = new Map(PERMISSION_CATALOGUE.map((entry) => [entry.key, entry.category]))

  it('(R2) lists PERMISSIONS entries in Object.entries(PERMISSIONS) order', () => {
    const names = Object.keys(PERMISSIONS)
    const positions = names.map((name) => rendered.indexOf(`  ${name}: '`))
    expect(positions.every((position) => position !== -1)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('(R2) each category comment appears exactly once, before its first key', () => {
    const orderedEntries = Object.entries(PERMISSIONS)
    for (const category of PERMISSION_CATEGORIES) {
      const commentLine = new RegExp(`^  // ${category}$`, 'm')
      const matches = rendered.match(new RegExp(commentLine, 'gm')) ?? []
      expect(matches.length).toBe(1)

      const commentIndex = rendered.search(commentLine)
      const firstKeyName = orderedEntries.find(
        ([, value]) => categoryByValue.get(value) === category
      )?.[0]
      expect(firstKeyName).toBeDefined()
      const firstKeyIndex = rendered.indexOf(`  ${firstKeyName}: '`)
      expect(commentIndex).toBeLessThan(firstKeyIndex)
    }
  })

  it('(R2) WORKSPACE_ADMIN_PERMISSIONS references every value by PERMISSIONS.<NAME>, in order', () => {
    const declStart = rendered.indexOf('export const WORKSPACE_ADMIN_PERMISSIONS')
    // The declaration reads `...: readonly PermissionKey[] = [`, so the first
    // `]` after declStart closes the TYPE annotation, not the array literal.
    // Anchor on the `[` that follows the `=` instead.
    const arrayStart = rendered.indexOf('[', rendered.indexOf('=', declStart))
    const arrayEnd = rendered.indexOf(']', arrayStart)
    const block = rendered.slice(arrayStart, arrayEnd)

    const positions = WORKSPACE_ADMIN_PERMISSIONS.map((value) => {
      const name = nameByValue.get(value)
      expect(name).toBeDefined()
      const position = block.indexOf(`PERMISSIONS.${name},`)
      expect(position).toBeGreaterThanOrEqual(0)
      return position
    })
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('(R2) SYSTEM_ROLE_PERMISSIONS.contributor references every value by PERMISSIONS.<NAME>, in order', () => {
    const blockStart = rendered.indexOf('contributor: [')
    const blockEnd = rendered.indexOf(']', blockStart)
    const block = rendered.slice(blockStart, blockEnd)

    const positions = SYSTEM_ROLE_PERMISSIONS.contributor.map((value) => {
      const name = nameByValue.get(value)
      expect(name).toBeDefined()
      const position = block.indexOf(`PERMISSIONS.${name},`)
      expect(position).toBeGreaterThanOrEqual(0)
      return position
    })
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })
})

describe('R3 — a catalogue inconsistency stops the generator', () => {
  afterEach(() => {
    vi.doUnmock('../rbac-catalogue')
    vi.resetModules()
  })

  it('(R3) a PERMISSIONS value with no catalogue entry throws naming the value', async () => {
    vi.doMock('../rbac-catalogue', () => ({
      PERMISSIONS: { ORPHAN: 'orphan.permission' },
      PERMISSION_CATALOGUE: [],
      PERMISSION_CATEGORIES: [],
      SYSTEM_ROLES: {},
      SYSTEM_ROLE_PERMISSIONS: { contributor: [] },
      WORKSPACE_ADMIN_PERMISSIONS: [],
    }))
    vi.resetModules()
    const { renderPermissionsMirror: renderBroken } = await import('../permissions-mirror')
    expect(() => renderBroken()).toThrow(
      'permissions-mirror: no catalogue category for orphan.permission'
    )
  })

  it('(R3) a WORKSPACE_ADMIN_PERMISSIONS value absent from PERMISSIONS throws naming the value', async () => {
    vi.doMock('../rbac-catalogue', () => ({
      PERMISSIONS: { KNOWN: 'known.permission' },
      PERMISSION_CATALOGUE: [{ key: 'known.permission', category: 'workspace' }],
      PERMISSION_CATEGORIES: ['workspace'],
      SYSTEM_ROLES: {},
      SYSTEM_ROLE_PERMISSIONS: { contributor: [] },
      WORKSPACE_ADMIN_PERMISSIONS: ['unknown.permission'],
    }))
    vi.resetModules()
    const { renderPermissionsMirror: renderBroken } = await import('../permissions-mirror')
    expect(() => renderBroken()).toThrow(
      'permissions-mirror: unknown permission value unknown.permission'
    )
  })
})
