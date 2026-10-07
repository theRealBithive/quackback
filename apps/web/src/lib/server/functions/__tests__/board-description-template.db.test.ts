/**
 * Saving a board's description template through the admin write path.
 * The contract is listed in full in `lib/shared/__tests__/post-template.test.ts`;
 * this suite holds the parts that live on the server:
 *
 *   V9  Template content is sanitized like other rich text; markup that could run
 *       script or link to `javascript:` never reaches an author's editor.
 *   V10 Only someone allowed to manage the board can change its template; only
 *       someone allowed to manage settings can change the workspace default.
 *       Readers see a board's template only for boards they are allowed to see.
 *   V11 Saving a board's template never discards the board's other settings
 *       (roadmap statuses, custom fields).
 *   V12 A template over the size limit is rejected at save time with a clear
 *       error, never truncated silently.
 *
 * A real database, because V11 is about what the stored row holds after the
 * write — a double of the service would only replay whatever merge it was
 * told to. Only the server-function wrapper and the session are substituted.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type BoardId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, eq, type BoardSettings } from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  POST_TEMPLATE_MAX_LENGTH,
  POST_TEMPLATE_TOO_LONG_MESSAGE,
} from '@/lib/shared/post-template'
import type { TiptapContent } from '@/lib/shared/db-types'

type ServerFnArgs = { data: unknown }

// Each server function becomes the plain async function its handler is, with
// its validator run first — so a test calls `updateBoardFn({ data })` exactly
// as the client does, and a schema rejection surfaces as the thrown error.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    validator: (schema: { parse: (data: unknown) => unknown }) => ({
      handler:
        (fn: (args: ServerFnArgs) => Promise<unknown>) =>
        ({ data }: ServerFnArgs) =>
          fn({ data: schema.parse(data) }),
    }),
    handler: (fn: (args: ServerFnArgs) => Promise<unknown>) => (args: ServerFnArgs) => fn(args),
  }),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const mockRequireAuth = vi.fn()
vi.mock('../auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}))

const { updateBoardFn } = (await import('../boards')) as unknown as {
  updateBoardFn: (args: ServerFnArgs) => Promise<unknown>
}

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: boards.id }).from(boards).limit(0)
  },
})

function docSaying(text: string): TiptapContent {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

const OTHER_SETTINGS: BoardSettings = {
  roadmapStatusIds: [],
  customFields: [{ key: 'version', label: 'Version', type: 'text', required: false }],
} as BoardSettings

async function seedBoard(settings: BoardSettings = {}): Promise<BoardId> {
  const id = createId('board') as BoardId
  await testDb.insert(boards).values({
    id,
    slug: `template-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Bugs',
    settings,
  })
  return id
}

async function storedSettings(id: BoardId): Promise<BoardSettings> {
  const [row] = await testDb
    .select({ settings: boards.settings })
    .from(boards)
    .where(eq(boards.id, id))
  return row.settings
}

/** updateBoardFn as the admin form calls it: one setting, nothing else. */
async function saveTemplate(id: BoardId, descriptionTemplate: unknown): Promise<unknown> {
  return updateBoardFn({ data: { id, settings: { descriptionTemplate } } })
}

describe.skipIf(!fixture.available)('saving a board description template', () => {
  beforeEach(async () => {
    await fixture.begin()
    mockRequireAuth.mockReset()
    mockRequireAuth.mockResolvedValue({})
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('stores the template next to the settings the board already had (V11)', async () => {
    const id = await seedBoard(OTHER_SETTINGS)
    const template = docSaying('Steps to reproduce:')

    await saveTemplate(id, template)

    const settings = await storedSettings(id)
    expect(settings.customFields).toEqual(OTHER_SETTINGS.customFields)
    expect(settings.roadmapStatusIds).toEqual(OTHER_SETTINGS.roadmapStatusIds)
    expect(settings.descriptionTemplate).toEqual(template)
  })

  it('replaces an earlier template rather than merging into it (V11)', async () => {
    const id = await seedBoard({ ...OTHER_SETTINGS, descriptionTemplate: docSaying('old') })

    await saveTemplate(id, { type: 'doc' })

    const settings = await storedSettings(id)
    expect(settings.descriptionTemplate).toEqual({ type: 'doc' })
    expect(settings.customFields).toEqual(OTHER_SETTINGS.customFields)
  })

  it('strips a javascript: link before storing (V9)', async () => {
    const id = await seedBoard()
    const hostile: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'click',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    }

    await saveTemplate(id, hostile)

    const stored = JSON.stringify((await storedSettings(id)).descriptionTemplate)
    expect(stored).toContain('click')
    expect(stored).not.toMatch(/javascript:/i)
  })

  it('asks for the board-management permission before writing (V10)', async () => {
    const id = await seedBoard(OTHER_SETTINGS)
    mockRequireAuth.mockRejectedValue(new Error('Forbidden'))

    await expect(saveTemplate(id, docSaying('Steps'))).rejects.toThrow('Forbidden')

    expect(mockRequireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.BOARD_MANAGE })
    expect((await storedSettings(id)).descriptionTemplate).toBeUndefined()
  })

  it('rejects a template over the limit and leaves the stored one alone (V12)', async () => {
    const earlier = docSaying('kept')
    const id = await seedBoard({ descriptionTemplate: earlier })

    const tooLong = docSaying('a'.repeat(POST_TEMPLATE_MAX_LENGTH))
    await expect(saveTemplate(id, tooLong)).rejects.toThrow(POST_TEMPLATE_TOO_LONG_MESSAGE)

    expect((await storedSettings(id)).descriptionTemplate).toEqual(earlier)
  })
})
