import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ValidationError } from '@/lib/shared/errors'

/**
 * ## T — Taxonomy names, colours, slugs, positions
 * - T1 A taxonomy name is stored trimmed. An empty or whitespace-only name is
 *   rejected, as is a name longer than the limit (50 unless the entity says
 *   otherwise), each with the message the calling entity supplies, verbatim.
 *
 * Status components and groups are the "unless the entity says otherwise" case:
 * their limit is 200 characters and their messages are their own ("Group name
 * …" / "Component name …"). They are not in T3's entity list, so this suite pins
 * T1 (coordinator's ruling, 2026-09-15; the agent had tagged it T3 as assigned).
 *
 * Pure unit test — the db module is stubbed so `validateName` (shared by the
 * component/group create+update paths) can be pinned without a database.
 * `eq`/`and`/`isNull`/`asc`/`sql`/`inArray` stay the REAL drizzle-orm
 * operators (spread from importOriginal) since `nextPosition` (a real,
 * unmocked helper) builds an actual `sql` fragment with them.
 */

const { mockInsertValues, mockInsertReturning, mockInsert, mockSelectFrom, mockSelect } =
  vi.hoisted(() => {
    const mockInsertReturning = vi.fn()
    const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }))
    const mockInsert = vi.fn(() => ({ values: mockInsertValues }))
    const mockSelectFrom = vi.fn()
    const mockSelect = vi.fn(() => ({ from: mockSelectFrom }))
    return { mockInsertValues, mockInsertReturning, mockInsert, mockSelectFrom, mockSelect }
  })

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    insert: mockInsert,
    select: mockSelect,
  },
}))

import { createStatusComponent, createStatusComponentGroup } from '../status.components'

/** `db.select({max: ...}).from(table)` awaited with no `.where` — the shape
 *  `nextPosition` uses when called without a filter (both callers here). */
function emptyTableSelect() {
  return Promise.resolve([{ max: -1 }])
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSelectFrom.mockReturnValue(emptyTableSelect())
})

describe('createStatusComponentGroup — name validation (T1)', () => {
  it('rejects an empty name with "Group name is required" (T1)', async () => {
    await expect(createStatusComponentGroup({ name: '   ' })).rejects.toThrow(
      new ValidationError('VALIDATION_ERROR', 'Group name is required')
    )
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects a name over 200 characters with "Group name must not exceed 200 characters" (T1)', async () => {
    await expect(createStatusComponentGroup({ name: 'x'.repeat(201) })).rejects.toThrow(
      new ValidationError('VALIDATION_ERROR', 'Group name must not exceed 200 characters')
    )
  })

  it('creates the group with the trimmed name at position 0 of an empty list (T1)', async () => {
    mockInsertReturning.mockResolvedValue([
      { id: 'status_component_group_1', name: 'Uptime', position: 0, collapsed: false },
    ])

    const result = await createStatusComponentGroup({ name: '  Uptime  ' })

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Uptime', position: 0 })
    )
    expect(result).toMatchObject({ id: 'status_component_group_1', name: 'Uptime' })
  })
})

describe('createStatusComponent — name validation (T1)', () => {
  it('rejects an empty name with "Component name is required" (T1)', async () => {
    await expect(createStatusComponent({ name: '' })).rejects.toThrow(
      new ValidationError('VALIDATION_ERROR', 'Component name is required')
    )
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects a name over 200 characters with "Component name must not exceed 200 characters" (T1)', async () => {
    await expect(createStatusComponent({ name: 'y'.repeat(201) })).rejects.toThrow(
      new ValidationError('VALIDATION_ERROR', 'Component name must not exceed 200 characters')
    )
  })

  it('creates the component with the trimmed name at position 0 of an empty list (T1)', async () => {
    mockInsertReturning.mockResolvedValue([
      {
        id: 'status_component_1',
        groupId: null,
        name: 'API',
        description: null,
        status: 'operational',
        position: 0,
        showUptime: true,
        segmentIds: [],
      },
    ])

    const result = await createStatusComponent({ name: '  API  ' })

    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ name: 'API' }))
    expect(result).toMatchObject({ id: 'status_component_1', name: 'API' })
  })
})
