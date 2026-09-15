/**
 * Server functions for tag operations — pins the module-level schema
 * aliases (`getTagSchema`, `deleteTagSchema`) that only run when the module
 * is imported, plus the auth gate and service delegation each handler wires
 * up.
 *
 * ## T — Taxonomy names, colours, slugs, positions
 * - T7 The shared request schemas reject what the per-entity ones rejected: a
 *   colour that is not `#rrggbb` (with the two historical messages kept
 *   apart), a name outside 1–50 characters, an empty reorder where the
 *   entity always refused one, and a page limit that is not an integer from
 *   1 to 100.
 *
 * `getTagSchema`/`deleteTagSchema` are aliases of `EntityIdSchema` — one of
 * the shared request schemas T7 covers — so the `.parse()` assertions below
 * pin T7 at this call site rather than restating T3 (T3 is about the
 * per-entity name/colour messages and default swatch, which this pair of
 * lines does not touch, and its entity list does not include this module).
 *
 * `createServerFn` is captured the way `admin-reset-two-factor.test.ts` does:
 * calling the exported const directly resolves to `undefined` in this
 * harness (no real Start request context — confirmed with a throwaway probe
 * against a bare `createServerFn(...).validator(...).handler(...)`), even
 * though the handler itself still runs and its thrown errors still
 * propagate. Capturing the handler sidesteps that entirely.
 *
 * The mock's `.validator()` also records the schema it was handed instead of
 * discarding it, so the assertions below exercise the *actual* schema
 * object each line assigns (`getTagSchema.parse(...)`,
 * `deleteTagSchema.parse(...)`) rather than merely executing the assignment
 * — a mock that dropped the argument would let a mutant swap either alias
 * for an unrelated schema without any test noticing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>
type AnyValidator = { parse: (value: unknown) => unknown }

const handlers: AnyHandler[] = []
const validators: AnyValidator[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator(schema: AnyValidator) {
        validators.push(schema)
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn().mockResolvedValue({ principal: { id: 'principal_admin' } }),
  listPostTags: vi.fn(),
  getTagById: vi.fn(),
  createPostTag: vi.fn(),
  updatePostTag: vi.fn(),
  deletePostTag: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
}))

vi.mock('@/lib/server/domains/post-tags/post-tag.service', () => ({
  listPostTags: hoisted.listPostTags,
  getTagById: hoisted.getTagById,
  createPostTag: hoisted.createPostTag,
  updatePostTag: hoisted.updatePostTag,
  deletePostTag: hoisted.deletePostTag,
}))

// Load the module ONCE — this is also what executes the module-level
// `getTagSchema = EntityIdSchema` (post-tags.ts:39) and
// `deleteTagSchema = EntityIdSchema` (post-tags.ts:50) aliases.
await import('../post-tags')

// Captured in declaration order: fetchTags(0), fetchTag(1), createPostTagFn(2),
// updatePostTagFn(3), deletePostTagFn(4), backfillAiTagsFn(5).
const fetchTag = handlers[1]
const deletePostTagFn = handlers[4]

// `validators[]` only grows on an actual `.validator()` call, and
// `fetchTags` (handlers[0]) has none — so its index runs one behind
// `handlers[]` from here on: fetchTag's getTagSchema(0), createTagSchema(1),
// updateTagSchema(2), deletePostTagFn's deleteTagSchema(3), backfillAiTagsSchema(4).
const getTagSchema = validators[0]
const deleteTagSchema = validators[3]

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_admin' } })
})

describe('fetchTag — getTagSchema is EntityIdSchema (post-tags.ts:39) (T7)', () => {
  it('accepts an id payload and returns it unchanged (T7)', () => {
    expect(getTagSchema.parse({ id: 'post_tag_1' })).toEqual({ id: 'post_tag_1' })
  })

  it('rejects a payload with no id (T7)', () => {
    expect(() => getTagSchema.parse({})).toThrow()
  })

  it('requires auth, looks the tag up by id, and returns it — proves the schema is wired to this handler (T7)', async () => {
    hoisted.getTagById.mockResolvedValue({ id: 'post_tag_1', name: 'Bug' })

    const result = await fetchTag({ data: { id: 'post_tag_1' } })

    expect(hoisted.requireAuth).toHaveBeenCalledOnce()
    expect(hoisted.getTagById).toHaveBeenCalledWith('post_tag_1')
    expect(result).toEqual({ id: 'post_tag_1', name: 'Bug' })
  })
})

describe('deletePostTagFn — deleteTagSchema is EntityIdSchema (post-tags.ts:50) (T7)', () => {
  it('accepts an id payload and returns it unchanged (T7)', () => {
    expect(deleteTagSchema.parse({ id: 'post_tag_1' })).toEqual({ id: 'post_tag_1' })
  })

  it('rejects a payload with no id (T7)', () => {
    expect(() => deleteTagSchema.parse({})).toThrow()
  })

  it('requires auth, deletes the tag, and returns its id — proves the schema is wired to this handler (T7)', async () => {
    const result = await deletePostTagFn({ data: { id: 'post_tag_1' } })

    expect(hoisted.requireAuth).toHaveBeenCalledOnce()
    expect(hoisted.deletePostTag).toHaveBeenCalledWith('post_tag_1')
    expect(result).toEqual({ id: 'post_tag_1' })
  })
})
