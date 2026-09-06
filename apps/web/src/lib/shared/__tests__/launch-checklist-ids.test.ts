/**
 * The launch checklist's names, as guarantees rather than as code.
 *
 * `launch-checklist.ts` stays English on purpose: it is the source of the
 * `defaultMessage` that both surfaces showing the checklist pass along, so a
 * reader whose language we do not ship still sees a readable sentence. What
 * has to exist beside it is a catalogue entry per name, and nothing in the
 * module itself can say whether one does.
 *
 * These refine V7 and V16 of the confirmed language contract for that module.
 * They are numbered L because the checklist is one surface, not the gate.
 *
 * L1 Every task name the wizard or the getting-started page can show has an
 *    entry in the shipped catalogue, so neither page shows an English task
 *    list inside an otherwise translated screen. [V7, V16]
 * L2 A task's name does not depend on the state of the workspace. That is what
 *    lets a single catalogue entry hold it: a name that changed with state
 *    would be pinned to whichever wording happened to be translated first,
 *    and the other wordings would silently stop being shown. [V16]
 * L3 The goal a workspace picked has an entry of its own. The wizard reads it
 *    into the middle of a sentence, so an untranslated goal puts an English
 *    word inside a translated line rather than on a line of its own. [V7]
 * L4 The catalogue carries no task name the checklist cannot produce. A task
 *    upstream removes would otherwise leave an entry behind that is paid for
 *    in nine languages and shown to nobody -- and the gate's own rule for
 *    unreachable keys cannot see it, because the pattern that builds these
 *    ids reads as reaching every one of them. [V16]
 *
 * Only `en.json` is read here. `locale-parity.test.ts` already holds the nine
 * catalogues to the same key set, so a key present in English and missing in
 * German is that suite's finding, not this one's.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import enMessages from '@/locales/en.json'
import { buildLaunchTasks, type LaunchStatus } from '@/lib/shared/launch-checklist'
import type { OnboardingOutcome } from '@/lib/shared/db-types'

const catalogue = enMessages as Record<string, string>

const OUTCOMES: OnboardingOutcome[] = [
  'product_feedback',
  'customer_support',
  'help_center',
  'internal',
]

const TITLE_KEY = /^activation\.task\.[^.]+\.[^.]+\.title$/

/** A workspace that has done nothing yet. Built here rather than at module
 *  scope: a mutant that crashes a fixture during collection is reported as
 *  survived, because the suite never runs and so nothing fails. */
function freshWorkspace(): LaunchStatus {
  return { hasBoards: false, memberCount: 1, hasBranding: false }
}

/** Every task name the checklist can produce, as id and English text. */
function reachableTitles(): Map<string, string> {
  const titles = new Map<string, string>()
  for (const outcome of OUTCOMES) {
    for (const task of buildLaunchTasks(freshWorkspace(), outcome)) {
      titles.set(`activation.task.${outcome}.${task.id}.title`, task.title)
    }
  }
  return titles
}

describe('launch checklist names in the catalogue (L1, L3, L4)', () => {
  it('defines every task name the checklist can produce (L1)', () => {
    const missing = [...reachableTitles().keys()].filter((id) => !catalogue[id])

    expect(missing).toEqual([])
  })

  it('produces the names it claims to, so the check is not empty (L1)', () => {
    // Without this the assertion above would pass against a checklist that
    // built no tasks at all, and prove nothing.
    expect(reachableTitles().size).toBe(19)
  })

  it('defines a name for every goal a workspace can pick (L3)', () => {
    const missing = OUTCOMES.filter((outcome) => !catalogue[`activation.goal.${outcome}`])

    expect(missing).toEqual([])
  })

  it('carries no task name the checklist cannot produce (L4)', () => {
    const reachable = reachableTitles()
    const stale = Object.keys(catalogue).filter((id) => TITLE_KEY.test(id) && !reachable.has(id))

    expect(stale).toEqual([])
  })
})

describe('what a task name is allowed to depend on (L2)', () => {
  it('gives a task the same name whatever the workspace has done (L2)', () => {
    // The one that decides the id scheme. A name that moved with the state
    // would need the state in its id, and a single entry per task would pin
    // the checklist to one wording. Descriptions do move -- which is why this
    // module authors names and leaves descriptions to their own change.
    const flag = fc.boolean()
    fc.assert(
      fc.property(
        fc.record({
          hasBoards: flag,
          hasPublicBoard: flag,
          hasInternalBoard: flag,
          hasWidgetInstalled: flag,
          hasWidgetEnabled: flag,
          hasHelpArticle: flag,
          hasIntegration: flag,
          hasFirstWin: flag,
          hasBranding: flag,
          memberCount: fc.integer({ min: 0, max: 5 }),
        }),
        fc.constantFrom(...OUTCOMES),
        (partial, outcome) => {
          const status: LaunchStatus = { ...partial }
          const fresh = reachableTitles()

          return buildLaunchTasks(status, outcome).every(
            (task) => fresh.get(`activation.task.${outcome}.${task.id}.title`) === task.title
          )
        }
      )
    )
  })
})
