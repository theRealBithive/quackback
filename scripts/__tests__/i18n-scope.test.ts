/**
 * What the i18n gate is declared to have translated.
 *
 * I12 A namespace we have not claimed yet is reported by name rather than
 *     failing the run. Claiming one is what turns its coverage into a promise,
 *     and a claim can therefore only ever make the gate louder. [V14]
 *
 * A claimed prefix is a declaration, not a measurement: it asserts that every
 * id the interface builds at runtime under that prefix resolves to something
 * a catalogue carries. So the list can be wrong in two directions and only one
 * of them is loud. A prefix claimed too early turns the next run red, which is
 * the point. A prefix *removed* turns nothing red at all — the gate would
 * simply promise less and still pass, the same way narrowing `coverage.include`
 * makes the coverage gate green by measuring less.
 *
 * This module is the counterweight: it asserts the whole list, so a removal is
 * a red test rather than a shorter report. Same device as
 * `mutation-scope.test.ts` and `coverage-scope.test.ts`, for the same reason.
 *
 * Growing the list is meant to be easy and to leave a trace: claim the prefix,
 * name it here, and the diff shows both.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

function manifest(): { claimedPrefixes: string[]; exemptions: unknown[] } {
  const file = path.resolve(import.meta.dirname, '../i18n-manifest.json')
  return JSON.parse(readFileSync(file, 'utf8'))
}

describe('the namespaces the i18n gate is declared to have translated (I12)', () => {
  it('claims the onboarding wizard, and nothing else yet', () => {
    // The admin's `activation.` namespace is the next one in line and is
    // deliberately absent: its launch checklist still holds English in a
    // module, so claiming it would assert something untrue.
    expect(manifest().claimedPrefixes).toEqual(['onboarding.'])
  })

  it('carries no exemption, so nothing is excused unread', () => {
    expect(manifest().exemptions).toEqual([])
  })
})
