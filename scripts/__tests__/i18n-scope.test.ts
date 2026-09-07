/**
 * What the i18n gate is declared to have translated.
 *
 * I12 A namespace we have not claimed yet is reported by name rather than
 *     failing the run. Claiming one is what turns its coverage into a promise,
 *     and a claim can therefore only ever make the gate louder. [V14]
 * I16 A file is checked because the manifest names it, not because of where it
 *     lives. Adding one asserts that it holds no untranslated text, and the
 *     list is asserted in full, so it cannot shrink into a shorter report.
 *     [V14]
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
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

function manifest(): {
  claimedPrefixes: string[]
  exemptions: unknown[]
  checkedFiles: string[]
} {
  const file = path.resolve(import.meta.dirname, '../i18n-manifest.json')
  return JSON.parse(readFileSync(file, 'utf8'))
}

describe('the namespaces the i18n gate is declared to have translated (I12)', () => {
  it('claims the onboarding wizard, and nothing else yet', () => {
    // The admin's `activation.` namespace is the next one in line and is
    // deliberately absent: its launch checklist still holds English in a
    // module, so claiming it would assert something untrue.
    expect(manifest().claimedPrefixes).toEqual(['auth.blocked.', 'notification.', 'onboarding.'])
  })

  it('carries no exemption, so nothing is excused unread', () => {
    expect(manifest().exemptions).toEqual([])
  })
})

describe('the files the i18n gate is declared to hold no text of their own (I16)', () => {
  it('claims the editor and the five primitives beside it, and nothing else yet', () => {
    // The three shadcn-generated primitives -- dialog, sheet, select -- are
    // deliberately absent. Their words are `sr-only` and reach a reader
    // through the caller, so they are claimed with the admin shell, where
    // those callers are being touched anyway.
    expect(manifest().checkedFiles).toEqual([
      'apps/web/src/components/ui/rich-text-editor.tsx',
      'apps/web/src/components/ui/mention-picker.tsx',
      'apps/web/src/components/ui/conversation-image-node.tsx',
      'apps/web/src/components/ui/quackback-embed-extension.tsx',
      'apps/web/src/components/ui/datetime-picker.tsx',
      'apps/web/src/components/ui/breadcrumbs.tsx',
    ])
  })

  it('names a file that is there, for every entry', () => {
    // The gate fails the run on a missing file rather than skipping it, but
    // only when someone runs it. Here it is caught on every test run, which is
    // what stops a rename from quietly retiring a claim.
    for (const name of manifest().checkedFiles) {
      const full = path.resolve(import.meta.dirname, '../..', name)
      expect(existsSync(full), `${name} is claimed but not there`).toBe(true)
    }
  })
})
