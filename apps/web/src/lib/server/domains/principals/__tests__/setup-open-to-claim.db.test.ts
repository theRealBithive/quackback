/**
 * Whether a workspace's setup is still waiting for its owner, against real
 * Postgres: `isSetupOpenToClaim`, the one predicate the onboarding promoter,
 * the claim screen, the wizard router and the signup exemption all share.
 *
 * Contract (upstream #656), confirmed:
 *
 * O1 While setup is still open, the first person who signs in can claim the workspace and becomes its admin.
 * O2 Once setup is complete, nobody can claim the workspace through the onboarding step: not a portal user and not a teammate, even when no human admin is left.
 * O3 A refused claim changes nothing: the workspace's name, slug and modules stay as they were, and the caller keeps the role they had.
 * O4 A workspace that was marked complete by its config file before its owner ever arrived still counts as open, so its first person can claim it.
 * O5 When the setup state cannot be read unambiguously, the workspace counts as closed.
 *
 * O3 is held by `functions/__tests__/onboarding-bootstrap-claim.db.test.ts`,
 * which drives the promoter itself. This suite holds the predicate's half of
 * O1, O2, O4 and O5.
 *
 * Setup states are never written by hand here. They are built by replaying a
 * history through the producers that write them in production — the config
 * file's `mergeSetupState` and the wizard's `applyDeferredLaunchStartingPoint`
 * — so the oracle can be stated about what happened ("did the owner finish the
 * wizard?") rather than about the shape of the JSON, which is what the code
 * under test reads.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import fc from 'fast-check'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { settings, sql, DEFAULT_SETUP_STATE } from '@/lib/server/db'
import type { SetupState } from '@/lib/shared/db-types'
import { mergeSetupState } from '@/lib/server/config-file/reconciler'
import { applyDeferredLaunchStartingPoint } from '@/lib/server/setup-state'
import { isSetupOpenToClaim } from '../bootstrap-admin'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: settings.id, setupState: settings.setupState }).from(settings).limit(0)
  },
})

const OUTCOMES = ['product_feedback', 'customer_support', 'help_center', 'internal'] as const

/** One thing that can happen to a workspace's setup state. */
type SetupEvent =
  | { kind: 'configNamesWorkspace' }
  | { kind: 'configMarksComplete'; useCase?: (typeof OUTCOMES)[number] }
  | { kind: 'ownerFinishesWizard'; outcome: (typeof OUTCOMES)[number] }

const setupEvent: fc.Arbitrary<SetupEvent> = fc.oneof(
  fc.constant({ kind: 'configNamesWorkspace' as const }),
  fc.record(
    {
      kind: fc.constant('configMarksComplete' as const),
      useCase: fc.constantFrom(...OUTCOMES),
    },
    { requiredKeys: ['kind'] }
  ),
  fc.record({
    kind: fc.constant('ownerFinishesWizard' as const),
    outcome: fc.constantFrom(...OUTCOMES),
  })
)

function applyEvent(state: SetupState | null, event: SetupEvent): SetupState {
  if (event.kind === 'configNamesWorkspace') {
    return mergeSetupState(state, { name: 'Acme' })
  }
  if (event.kind === 'configMarksComplete') {
    return mergeSetupState(state, { onboardingComplete: true, useCase: event.useCase })
  }
  const current = state ?? DEFAULT_SETUP_STATE
  return applyDeferredLaunchStartingPoint(current, event.outcome)
}

function replay(history: readonly SetupEvent[]): SetupState | null {
  let state: SetupState | null = null
  for (const event of history) {
    state = applyEvent(state, event)
  }
  return state
}

function ownerFinishedTheWizard(history: readonly SetupEvent[]): boolean {
  return history.some((event) => event.kind === 'ownerFinishesWizard')
}

/** Replace whatever settings rows the transaction holds with exactly one. */
async function onlySettingsRow(setupState: string | null): Promise<void> {
  await testDb.execute(sql`DELETE FROM settings`)
  await insertSettingsRow(setupState)
}

async function insertSettingsRow(setupState: string | null): Promise<void> {
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Acme',
    slug: `acme-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date(),
    setupState,
  })
}

describe.skipIf(!fixture.available)('isSetupOpenToClaim', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('reads a fresh install with no settings row as open (O1)', async () => {
    await testDb.execute(sql`DELETE FROM settings`)

    expect(await isSetupOpenToClaim(testDb)).toBe(true)
  })

  it('reads a settings row whose setup never started as open (O1)', async () => {
    await onlySettingsRow(null)

    expect(await isSetupOpenToClaim(testDb)).toBe(true)
  })

  it('reads a wizard the owner finished as closed (O2)', async () => {
    const finished = replay([{ kind: 'ownerFinishesWizard', outcome: 'product_feedback' }])
    await onlySettingsRow(JSON.stringify(finished))

    expect(await isSetupOpenToClaim(testDb)).toBe(false)
  })

  it('reads a workspace the config file stamped complete as open (O4)', async () => {
    const stamped = replay([{ kind: 'configMarksComplete' }])
    await onlySettingsRow(JSON.stringify(stamped))

    expect(await isSetupOpenToClaim(testDb)).toBe(true)
  })

  // The other half of O4: the stamp keeps the workspace open for its first
  // owner, not forever. Once that owner has been through the wizard, the
  // workspace is finished like any other.
  it('closes a config-stamped workspace once its owner has finished the wizard (O4, O2)', async () => {
    const stamped = replay([{ kind: 'configMarksComplete' }])
    const ownerArrived = replay([
      { kind: 'configMarksComplete' },
      { kind: 'ownerFinishesWizard', outcome: 'customer_support' },
    ])

    await onlySettingsRow(JSON.stringify(stamped))
    expect(await isSetupOpenToClaim(testDb)).toBe(true)

    await onlySettingsRow(JSON.stringify(ownerArrived))
    expect(await isSetupOpenToClaim(testDb)).toBe(false)
  })

  // Unguarded across every history: the answer is closed exactly when the
  // owner went through the wizard, whatever the config file did before or
  // after. Reaches: no history (fresh), config-named only, config-stamped
  // only, owner-finished only, stamp then owner, owner then stamp, and
  // repeated events of each kind.
  it('is open exactly until the owner has finished the wizard, whatever the config file did (O1, O2, O4)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(setupEvent, { maxLength: 5 }), async (history) => {
        const state = replay(history)
        const stored = state === null ? null : JSON.stringify(state)
        await onlySettingsRow(stored)

        const open = await isSetupOpenToClaim(testDb)

        expect(open).toBe(!ownerFinishedTheWizard(history))
      }),
      { numRuns: 60 }
    )
  })

  it('reads two settings rows as closed, even when each alone would be open (O5)', async () => {
    await onlySettingsRow(null)
    await insertSettingsRow(null)

    expect(await isSetupOpenToClaim(testDb)).toBe(false)
  })

  // A stored setup state that does not parse is not the same thing as no
  // setup state: it may be a finished install whose row was damaged, and
  // reading it as "never started" would reopen the claim O2 closes.
  // Reaches: text that is not JSON, and JSON that is not an object (null,
  // numbers, strings, arrays).
  it('reads a stored setup state that cannot be parsed as closed (O5)', async () => {
    const notJson = fc.string({ minLength: 1, maxLength: 30 }).map((text) => `<${text}`)
    const jsonButNotAnObject = fc.oneof(
      fc.constant('null'),
      fc.integer().map((n) => JSON.stringify(n)),
      fc.string({ maxLength: 20 }).map((text) => JSON.stringify(text)),
      fc.array(fc.integer(), { maxLength: 3 }).map((list) => JSON.stringify(list))
    )

    await fc.assert(
      fc.asyncProperty(fc.oneof(notJson, jsonButNotAnObject), async (stored) => {
        await onlySettingsRow(stored)

        expect(await isSetupOpenToClaim(testDb)).toBe(false)
      }),
      { numRuns: 40 }
    )
  })
})
