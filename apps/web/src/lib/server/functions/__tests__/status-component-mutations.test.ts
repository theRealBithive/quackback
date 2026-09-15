/**
 * Status-page server functions — pins the module-level schema aliases
 * (`idSchema`, `reorderIdsSchema`, status.ts:210-211) that only run when the
 * module is imported and that most of the admin component/group/incident
 * mutations below share.
 *
 * ## T — Taxonomy names, colours, slugs, positions
 * - T7 The shared request schemas reject what the per-entity ones rejected: a
 *   colour that is not `#rrggbb` (with the two historical messages kept
 *   apart), a name outside 1–50 characters, an empty reorder where the
 *   entity always refused one, and a page limit that is not an integer from
 *   1 to 100.
 *
 * `idSchema`/`reorderIdsSchema` alias `EntityIdSchema`/`ReorderIdsSchema` —
 * the shared request schemas T7 covers — so the assertions below pin T7's
 * "empty reorder where the entity always refused one" clause at this call
 * site (not T3: T3 is the per-entity name/colour messages and default
 * swatch, which these two lines do not touch, and its entity list —
 * post tags, conversation labels, changelog categories, post statuses,
 * ticket types and ticket statuses — does not include status components).
 *
 * `createServerFn` is captured (not called through the exported const): a
 * throwaway probe against a bare `createServerFn(...).validator(...).handler(...)`
 * showed the exported const resolves to `undefined` in this harness (no real
 * Start request context), even though the handler itself still runs. See
 * `post-tags.test.ts` for the same finding.
 *
 * The mock's `.validator()` records the schema it was handed instead of
 * discarding it, so `idSchema` and `reorderIdsSchema` are asserted by their
 * actual `.parse()` behaviour (an id payload vs. an ids-array payload), not
 * merely by having executed the assignment. `idSchema` (`EntityIdSchema`)
 * and `reorderIdsSchema` (`ReorderIdsSchema`) accept disjoint shapes, so a
 * mutant that swapped the two aliases at 210/211 — or matched a stray
 * `idSchema`/`reorderIdsSchema` elsewhere in the file to the wrong handler —
 * fails one of the four `.parse()` assertions below.
 *
 * Handlers are captured in DECLARATION ORDER (matching every other
 * `functions/__tests__` suite that captures via this mock). `idSchema` and
 * `reorderIdsSchema` are declared right above `deleteStatusComponentFn` and
 * `reorderStatusComponentsFn` — the third and fourth `createServerFn` calls
 * in the file — so indices 3 and 4 are these two, and a reorder of the file
 * would fail this suite loudly (wrong mock called) rather than silently.
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
  deleteStatusComponent: vi.fn().mockResolvedValue(undefined),
  reorderStatusComponents: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
  getOptionalAuth: vi.fn(),
  policyActorFromAuth: vi.fn(),
}))

vi.mock('@/lib/server/functions/portal-access', () => ({
  resolvePortalAccessForRequest: vi.fn(),
}))

vi.mock('@/lib/server/domains/status', () => ({
  createStatusComponentGroup: vi.fn(),
  updateStatusComponentGroup: vi.fn(),
  deleteStatusComponentGroup: vi.fn(),
  reorderStatusComponentGroups: vi.fn(),
  listStatusComponentGroupsWithComponents: vi.fn(),
  listUngroupedStatusComponents: vi.fn(),
  createStatusComponent: vi.fn(),
  updateStatusComponent: vi.fn(),
  deleteStatusComponent: hoisted.deleteStatusComponent,
  reorderStatusComponents: hoisted.reorderStatusComponents,
  setComponentStatus: vi.fn(),
  createIncident: vi.fn(),
  updateIncident: vi.fn(),
  postIncidentUpdate: vi.fn(),
  deleteIncident: vi.fn(),
  clearStatusHistory: vi.fn(),
  getStatusIncidentById: vi.fn(),
  listStatusIncidents: vi.fn(),
  countStatusIncidentsSince: vi.fn(),
  countStatusSubscriptionsSince: vi.fn(),
  startMaintenanceNow: vi.fn(),
  deriveTopLevelStatus: vi.fn(),
  listStatusIncidentTemplates: vi.fn(),
  createStatusIncidentTemplate: vi.fn(),
  updateStatusIncidentTemplate: vi.fn(),
  deleteStatusIncidentTemplate: vi.fn(),
  listStatusSubscriptions: vi.fn(),
  getStatusSubscriptionCounts: vi.fn(),
  addStatusSubscriberByEmail: vi.fn(),
  importStatusSubscribersFromEmails: vi.fn(),
  listAllStatusSubscribersForExport: vi.fn(),
  countActiveSubscribersForComponents: vi.fn(),
  isStatusAudienceGranted: vi.fn(),
  getStatusPageSnapshot: vi.fn(),
  getPublicStatusIncident: vi.fn(),
  getUptimeSeries: vi.fn(),
  listIncidentHistory: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/settings.status', () => ({
  getStatusSettings: vi.fn(),
  updateStatusSettings: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceStatusComponentLimit: vi.fn(),
}))

// Load the module ONCE — this is also what executes the module-level
// `idSchema = EntityIdSchema` / `reorderIdsSchema = ReorderIdsSchema`
// aliases (status.ts:210-211).
await import('../status')

// Declaration order: listStatusComponentsAdminFn(0), createStatusComponentFn(1),
// updateStatusComponentFn(2), deleteStatusComponentFn(3), reorderStatusComponentsFn(4), …
const deleteStatusComponentFn = handlers[3]
const reorderStatusComponentsFn = handlers[4]

// `validators[]` only grows on an actual `.validator()` call, and
// `listStatusComponentsAdminFn` (handlers[0]) has none — so its index runs
// one behind `handlers[]` from here on: createStatusComponentSchema(0),
// updateStatusComponentSchema(1), idSchema(2), reorderIdsSchema(3).
const idSchema = validators[2]
const reorderIdsSchema = validators[3]

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_admin' } })
  hoisted.deleteStatusComponent.mockResolvedValue(undefined)
  hoisted.reorderStatusComponents.mockResolvedValue(undefined)
})

describe('deleteStatusComponentFn — idSchema is EntityIdSchema (status.ts:210) (T7)', () => {
  it('accepts an id payload and returns it unchanged (T7)', () => {
    expect(idSchema.parse({ id: 'status_component_1' })).toEqual({ id: 'status_component_1' })
  })

  it('rejects an ids-array payload — proves it is not reorderIdsSchema (T7)', () => {
    expect(() => idSchema.parse({ ids: ['a', 'b'] })).toThrow()
  })

  it('requires auth, deletes the component by id, and reports success — proves the schema is wired to this handler (T7)', async () => {
    const result = await deleteStatusComponentFn({ data: { id: 'status_component_1' } })

    expect(hoisted.requireAuth).toHaveBeenCalledOnce()
    expect(hoisted.deleteStatusComponent).toHaveBeenCalledWith('status_component_1')
    expect(result).toEqual({ success: true })
  })
})

describe('reorderStatusComponentsFn — reorderIdsSchema is ReorderIdsSchema (status.ts:211) (T7)', () => {
  it('accepts an ids-array payload and returns it unchanged (T7)', () => {
    expect(reorderIdsSchema.parse({ ids: ['a', 'b'] })).toEqual({ ids: ['a', 'b'] })
  })

  it('rejects an empty ids array — the entity always refused one (T7)', () => {
    expect(() => reorderIdsSchema.parse({ ids: [] })).toThrow()
  })

  it('rejects an id payload — proves it is not idSchema (T7)', () => {
    expect(() => reorderIdsSchema.parse({ id: 'status_component_1' })).toThrow()
  })

  it('requires auth, reorders the given ids, and reports success — proves the schema is wired to this handler (T7)', async () => {
    const result = await reorderStatusComponentsFn({
      data: { ids: ['status_component_2', 'status_component_1'] },
    })

    expect(hoisted.requireAuth).toHaveBeenCalledOnce()
    expect(hoisted.reorderStatusComponents).toHaveBeenCalledWith([
      'status_component_2',
      'status_component_1',
    ])
    expect(result).toEqual({ success: true })
  })
})
