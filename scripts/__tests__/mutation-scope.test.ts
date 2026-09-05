/**
 * What the mutation gate is declared to grade.
 *
 * B4 Mutants are generated only for code this change touched, and the run finishes
 *    within a stated time budget.
 * B6 An equivalence record excuses exactly one mutation at one location. It cannot
 *    silence a different mutation, nor the same one once the line has changed.
 *
 * The manifest is a declaration, not a measurement: an entry asserts that the
 * suites it names pin that file on their own. So the list can be wrong in two
 * directions, and only one of them is loud. A file whose suites do not actually
 * pin it turns the next change to it red, which is the point. A file *removed*
 * from the list turns nothing red at all — the gate would simply grade less and
 * still pass, exactly the way narrowing `coverage.include` makes the coverage
 * gate green by measuring less.
 *
 * This module is the counterweight: it asserts the whole list, so a removal is a
 * red test rather than a shorter report. It is the same device as
 * `coverage-scope.test.ts`, for the same reason.
 *
 * Growing the list is meant to be easy and is meant to leave a trace: add the
 * entry, add it here, and the diff shows both.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { readManifest } from '../mutation-policy'

function manifest() {
  const file = path.resolve(import.meta.dirname, '../mutation-manifest.json')
  return readManifest(JSON.parse(readFileSync(file, 'utf8')))
}

describe('the files the mutation gate is declared to grade (B4)', () => {
  it('declares every mutation-graded file with the suites that pin it, and nothing else', () => {
    expect(manifest().graded).toEqual([
      { file: 'scripts/audit-policy.ts', suites: ['scripts/__tests__/audit-policy.test.ts'] },
      {
        file: 'scripts/diff-coverage-policy.ts',
        suites: ['scripts/__tests__/diff-coverage-policy.test.ts'],
      },
      {
        file: 'scripts/mutation-policy.ts',
        suites: ['scripts/__tests__/mutation-policy.test.ts'],
      },
      {
        file: 'apps/web/src/lib/server/integrations/board-routing-policy.ts',
        suites: ['apps/web/src/lib/server/integrations/__tests__/board-routing-policy.test.ts'],
      },
      {
        file: 'apps/web/src/integrations/gitlab/server/post-source.ts',
        suites: ['apps/web/src/integrations/gitlab/server/__tests__/post-source.db.test.ts'],
      },
      {
        file: 'apps/web/src/lib/server/events/resolvers/integration.resolver.ts',
        suites: [
          'apps/web/src/lib/server/events/__tests__/board-issue-routing.test.ts',
          'apps/web/src/lib/server/events/__tests__/board-issue-routing.db.test.ts',
          'apps/web/src/lib/server/events/__tests__/integration-resolver.test.ts',
        ],
      },
    ])
  })

  it('names a suite that exists for every entry', () => {
    // A renamed suite makes vitest match nothing, which the gate refuses as a
    // run that measured nothing — but only once someone changes that file.
    // Here it is caught on every run.
    for (const entry of manifest().graded) {
      for (const suite of entry.suites) {
        const absolute = path.resolve(import.meta.dirname, '../..', suite)
        expect(() => readFileSync(absolute, 'utf8'), `${entry.file} names ${suite}`).not.toThrow()
      }
    }
  })
})

describe('the mutations excused as equivalent (B6)', () => {
  it('excuses exactly these mutations, each with a reason', () => {
    expect(manifest().equivalents).toEqual([
      {
        file: 'scripts/diff-coverage-policy.ts',
        mutator: 'EqualityOperator',
        line: 'if (highest === undefined || highest < count) known.executions.set(line, count)',
        replacement: 'highest <= count',
        why: expect.stringContaining('same number it replaced'),
      },
      {
        file: 'scripts/diff-coverage-policy.ts',
        mutator: 'EqualityOperator',
        line: 'if (best === undefined || best < count) executions.set(line, count)',
        replacement: 'best <= count',
        why: expect.stringContaining('equal value'),
      },
    ])
  })

  it('still finds the line each record was written for', () => {
    // The record is addressed by the text of its line. When the line is edited
    // the record retires, and the gate reports it as stale on the next run
    // against that file — but that run only happens when someone touches it.
    // This check is on every run, so a record cannot quietly outlive its line.
    for (const record of manifest().equivalents) {
      const source = readFileSync(path.resolve(import.meta.dirname, '../..', record.file), 'utf8')
      const lines = source.split('\n').map((line) => line.trim())
      expect(lines, `${record.file} no longer holds \`${record.line}\``).toContain(record.line)
    }
  })

  it('excuses a mutation only in a file the gate actually grades', () => {
    const graded = manifest().graded.map((entry) => entry.file)
    for (const record of manifest().equivalents) {
      expect(graded, `${record.file} is excused but never mutated`).toContain(record.file)
    }
  })
})
