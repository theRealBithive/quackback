/**
 * The workspace default description template: how it is saved and what
 * readers receive. The contract is listed in full in
 * `lib/shared/__tests__/post-template.test.ts`; this suite holds:
 *
 *   V4  A template that holds no visible text counts as "no template" (board
 *       falls back to the workspace default; workspace default means nothing).
 *   V9  Template content is sanitized like other rich text; markup that could run
 *       script or link to `javascript:` never reaches an author's editor.
 *   V10 Only someone allowed to manage the board can change its template; only
 *       someone allowed to manage settings can change the workspace default.
 *       Readers see a board's template only for boards they are allowed to see.
 *
 * A real settings row, because the failure worth catching is in the stored
 * JSON: portalConfig is deep-merged on write, and a document deep-merged over
 * an older one keeps the older text wherever the new one has no `content`.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { settings } from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { TiptapContent } from '@/lib/shared/db-types'

type ServerFnArgs = { data: unknown }

// Each server function becomes the plain async function its handler is, with
// its validator run first.
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

// A cache hit would let one case answer another's question.
vi.mock('@/lib/server/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/cache')>()),
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => undefined),
  cacheDel: vi.fn(async () => undefined),
}))

const mockRequireAuth = vi.fn()
vi.mock('@/lib/server/functions/auth-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/auth-helpers')>()),
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}))

const { getPortalConfig, getPublicPortalConfig, getWorkspaceSettings } =
  await import('../settings.service')
const { updatePortalConfigFn } = (await import('@/lib/server/functions/settings')) as unknown as {
  updatePortalConfigFn: (args: ServerFnArgs) => Promise<unknown>
}

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: settings.id }).from(settings).limit(0)
  },
})

function docSaying(text: string): TiptapContent {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

async function seedWorkspace(portalConfig: Record<string, unknown> = {}): Promise<void> {
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Acme',
    slug: `acme-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date(),
    portalConfig: JSON.stringify(portalConfig),
  })
}

async function saveDefaultTemplate(postTemplate: unknown): Promise<unknown> {
  return updatePortalConfigFn({ data: { postTemplate } })
}

describe.skipIf(!fixture.available)('the workspace default post template', () => {
  beforeEach(async () => {
    await fixture.begin()
    mockRequireAuth.mockReset()
    mockRequireAuth.mockResolvedValue({})
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('is stored as given and reaches readers (V4, the visible case)', async () => {
    await seedWorkspace()
    const template = docSaying('What are you trying to do?')

    await saveDefaultTemplate(template)

    expect((await getPortalConfig()).postTemplate).toEqual(template)
    expect((await getPublicPortalConfig()).postTemplate).toEqual(template)
    expect((await getWorkspaceSettings())?.publicPortalConfig?.postTemplate).toEqual(template)
  })

  it('replaces the earlier template instead of keeping its text (V4)', async () => {
    await seedWorkspace({ postTemplate: docSaying('old wording') })

    await saveDefaultTemplate({ type: 'doc' })

    const stored = JSON.stringify((await getPortalConfig()).postTemplate)
    expect(stored).not.toContain('old wording')
  })

  it('reaches no reader once it holds no visible text (V4)', async () => {
    await seedWorkspace({ postTemplate: docSaying('old wording') })

    await saveDefaultTemplate({ type: 'doc', content: [{ type: 'paragraph' }] })

    expect((await getPublicPortalConfig()).postTemplate).toBeUndefined()
    expect((await getWorkspaceSettings())?.publicPortalConfig?.postTemplate).toBeUndefined()
  })

  it('strips a javascript: link before storing (V9)', async () => {
    await seedWorkspace()
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

    await saveDefaultTemplate(hostile)

    const stored = JSON.stringify((await getPortalConfig()).postTemplate)
    expect(stored).toContain('click')
    expect(stored).not.toMatch(/javascript:/i)
  })

  it('leaves the other portal settings alone (V4)', async () => {
    await seedWorkspace({ openSignup: true })

    await saveDefaultTemplate(docSaying('Steps'))

    expect((await getPortalConfig()).openSignup).toBe(true)
  })

  it('asks for the settings-management permission before writing (V10)', async () => {
    const earlier = docSaying('kept')
    await seedWorkspace({ postTemplate: earlier })
    mockRequireAuth.mockRejectedValue(new Error('Forbidden'))

    await expect(saveDefaultTemplate(docSaying('changed'))).rejects.toThrow('Forbidden')

    expect(mockRequireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.SETTINGS_MANAGE })
    expect((await getPortalConfig()).postTemplate).toEqual(earlier)
  })
})
