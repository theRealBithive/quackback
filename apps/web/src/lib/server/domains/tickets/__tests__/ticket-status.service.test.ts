/**
 * Real-DB coverage for ticket status management (support platform §4.2): the
 * create/reorder happy paths and the three delete guards (default, last-of-
 * category, in-use — the block-if-in-use policy). Runs inside the db-test-fixture
 * rollback transaction (see server/__tests__/README.md).
 *
 * ## T — Taxonomy names, colours, slugs, positions
 * - T3 Post tags, conversation labels, changelog categories, post statuses,
 *   ticket types and ticket statuses keep their pre-consolidation rejection
 *   messages word for word, and a create payload without a colour gets the
 *   shared default swatch `#6b7280`.
 * - T8 Update paths validate like create paths: renaming or recolouring a
 *   post tag, conversation label, changelog category, post status, ticket
 *   status or ticket type applies the same name and colour rules and
 *   messages as creating one.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { ValidationError } from '@/lib/shared/errors'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { tickets, ticketStatuses, isNull } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  createTicketStatus,
  softDeleteTicketStatus,
  listTicketStatuses,
  reorderTicketStatuses,
  updateTicketStatusEntity,
} from '../ticket-status.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketStatuses.id }).from(ticketStatuses).limit(0)
    await db.select({ id: tickets.id }).from(tickets).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/** Soft-delete every committed status so a test's seeded set is authoritative. */
async function cleanSlate(): Promise<void> {
  await testDb
    .update(ticketStatuses)
    .set({ deletedAt: new Date() })
    .where(isNull(ticketStatuses.deletedAt))
}

async function seedStatus(opts: { category: 'open' | 'pending' | 'closed'; isDefault?: boolean }) {
  const [row] = await testDb
    .insert(ticketStatuses)
    .values({
      name: `S-${suffix()}`,
      slug: `s_${suffix()}`,
      category: opts.category,
      position: 0,
      isDefault: opts.isDefault ?? false,
    })
    .returning()
  return row
}

describe.skipIf(!fixture.available)('ticket-status.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('createTicketStatus derives a slug and appends after the last position', async () => {
    await cleanSlate()
    await seedStatus({ category: 'open', isDefault: true })
    const created = await createTicketStatus({
      name: 'Waiting on vendor',
      color: '#8b5cf6',
      category: 'pending',
      publicStage: 'in_progress',
    })
    expect(created.slug).toMatch(/^waiting_on_vendor/)
    expect(created.publicStage).toBe('in_progress')
    const listed = await listTicketStatuses()
    expect(listed.some((s) => s.id === created.id)).toBe(true)
  })

  it('cannot delete the default status', async () => {
    await cleanSlate()
    const def = await seedStatus({ category: 'open', isDefault: true })
    await seedStatus({ category: 'open' })
    await expect(softDeleteTicketStatus(def.id)).rejects.toThrow(/default status/i)
  })

  it('cannot delete the last status of a category', async () => {
    await cleanSlate()
    await seedStatus({ category: 'open', isDefault: true })
    const onlyPending = await seedStatus({ category: 'pending' })
    await expect(softDeleteTicketStatus(onlyPending.id)).rejects.toThrow(/last 'pending' status/i)
  })

  it('cannot delete a status a live ticket still uses', async () => {
    await cleanSlate()
    await seedStatus({ category: 'open', isDefault: true })
    const inUse = await seedStatus({ category: 'open' })
    await testDb.insert(tickets).values({ type: 'customer', title: 'On it', statusId: inUse.id })
    await expect(softDeleteTicketStatus(inUse.id)).rejects.toThrow(/ticket\(s\) use it/i)
  })

  it('soft-deletes a status that is safe to remove', async () => {
    await cleanSlate()
    await seedStatus({ category: 'open', isDefault: true })
    const removable = await seedStatus({ category: 'open' })
    await softDeleteTicketStatus(removable.id)
    const listed = await listTicketStatuses()
    expect(listed.some((s) => s.id === removable.id)).toBe(false)
  })

  it('reorderTicketStatuses writes each id its index as position', async () => {
    await cleanSlate()
    const a = await seedStatus({ category: 'open', isDefault: true })
    const b = await seedStatus({ category: 'open' })
    await reorderTicketStatuses([b.id, a.id])
    const listed = await listTicketStatuses()
    const byId = new Map(listed.map((s) => [s.id, s.position]))
    expect(byId.get(b.id)).toBe(0)
    expect(byId.get(a.id)).toBe(1)
  })

  it('updateTicketStatusEntity rejects an empty rename with "Name cannot be empty" (T3, T8)', async () => {
    await cleanSlate()
    const status = await seedStatus({ category: 'open', isDefault: true })
    await expect(updateTicketStatusEntity(status.id, { name: '   ' })).rejects.toThrow(
      new ValidationError('VALIDATION_ERROR', 'Name cannot be empty')
    )
  })

  it('updateTicketStatusEntity rejects an over-length rename with "Name must be 50 characters or less" (T3, T8)', async () => {
    await cleanSlate()
    const status = await seedStatus({ category: 'open', isDefault: true })
    await expect(updateTicketStatusEntity(status.id, { name: 'x'.repeat(51) })).rejects.toThrow(
      new ValidationError('VALIDATION_ERROR', 'Name must be 50 characters or less')
    )
  })

  it('updateTicketStatusEntity applies a valid rename, trimmed (T3, T8)', async () => {
    await cleanSlate()
    const status = await seedStatus({ category: 'open', isDefault: true })
    const updated = await updateTicketStatusEntity(status.id, { name: '  Renamed  ' })
    expect(updated.name).toBe('Renamed')
  })

  it('updateTicketStatusEntity rejects an invalid update colour with "Color must be in hex format (e.g., #3b82f6)" (T3, T8)', async () => {
    await cleanSlate()
    const status = await seedStatus({ category: 'open', isDefault: true })
    await expect(updateTicketStatusEntity(status.id, { color: 'not-a-color' })).rejects.toThrow(
      new ValidationError('VALIDATION_ERROR', 'Color must be in hex format (e.g., #3b82f6)')
    )
  })

  it('updateTicketStatusEntity applies a valid update colour (T3, T8)', async () => {
    await cleanSlate()
    const status = await seedStatus({ category: 'open', isDefault: true })
    const updated = await updateTicketStatusEntity(status.id, { color: '#654321' })
    expect(updated.color).toBe('#654321')
  })
})
