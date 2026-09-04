/**
 * The mutation gate's policy, as guarantees rather than as code.
 *
 * B1 The gate judges the lines this change added or touched, never the repository
 *    total.
 * B2 An added executable line that no test executes fails the gate, named by file
 *    and line.
 * B3 A change that adds no executable lines passes, without anyone writing an
 *    exemption for it.
 * B4 Mutants are generated only for code this change touched, and the run finishes
 *    within a stated time budget.
 * B5 A surviving mutant fails the gate, reported as file, line, and the change
 *    that survived.
 * B6 An equivalence record excuses exactly one mutation at one location. It cannot
 *    silence a different mutation, nor the same one once the line has changed.
 * B7 A gate that could not measure fails rather than passes — no diff base,
 *    missing provider, budget exceeded.
 * B8 The comparison is against the merge base of the change, so a branch cannot
 *    pass by comparing against itself.
 * B9 A mutant the selected suites never executed is not graded, and fails the
 *    gate exactly like a survivor. A file is scored over all its mutants, never
 *    over the covered ones alone.
 *
 * The confirmed list is above in full. B1, B2, B3 and B8 are the coverage half
 * and live in `diff-coverage-policy.test.ts`; they stay written down here so
 * nobody re-derives a shorter list from one half of it.
 *
 * B9 was added after a measurement, and it is the reason this module grades the
 * way it does. Run on `apps/web/src/lib/server/auth/sign-in-method-availability.ts`
 * on 2026-09-04, its co-located suite killed 58 mutants, 5 survived, and **30
 * were never executed at all** — the suite covers the module's pure half and
 * nothing from line 119 down. Stryker reports that as `62.37% total / 92.06%
 * covered`, and 92.06% is the number it prints large. A gate written to B5 alone
 * would pass that module: an unexecuted mutant is not a `Survived` in Stryker's
 * vocabulary. So the failing set here is `Survived` *and* `NoCoverage`, and the
 * score is always over every mutant.
 *
 * Two things this module deliberately does not do. It does not fail on a
 * `CompileError`: that is Stryker failing to build an invalid mutant, not a gap
 * in a suite, and it is reported by count instead. And it does not decide which
 * suites cover which file — that is a declaration in `mutation-manifest.json`,
 * asserted in full by `mutation-scope.test.ts`, because a selection derived by
 * convention would grade files whose co-located suite was never claimed to pin
 * them.
 *
 * Pure by design — no git, no file reads, no exit, no runner. The gate around it
 * (`mutation-check.ts`) does that, and its own guarantees are covered by
 * `mutation-gate.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  filesTouchedBy,
  formatVerdict,
  gradeReport,
  readManifest,
  readMeasurement,
  selectForChange,
  type EquivalenceRecord,
  type Manifest,
  type Mutant,
  type MutationReport,
} from '../mutation-policy'

const SEED_MANIFEST: Manifest = {
  graded: [
    { file: 'scripts/audit-policy.ts', suites: ['scripts/__tests__/audit-policy.test.ts'] },
    {
      file: 'scripts/diff-coverage-policy.ts',
      suites: ['scripts/__tests__/diff-coverage-policy.test.ts'],
    },
  ],
  equivalents: [],
}

function mutant(over: Partial<Mutant> = {}): Mutant {
  return {
    mutatorName: 'EqualityOperator',
    status: 'Killed',
    replacement: 'a <= b',
    location: { start: { line: 2 } },
    ...over,
  }
}

/** A report over one file whose source is the given lines. */
function reportOf(file: string, source: string[], mutants: Mutant[]): MutationReport {
  return {
    files: { [file]: { source: source.join('\n'), mutants } },
    testFiles: { 'some.test.ts': { tests: [{ id: '1', name: 'a test' }] } },
  }
}

describe('what a change reaches (B4)', () => {
  it('reaches the files it edited', () => {
    expect(
      filesTouchedBy({ changed: ['scripts/audit-policy.ts', 'README.md'], manifest: SEED_MANIFEST })
    ).toEqual(['scripts/audit-policy.ts', 'README.md'])
  })

  it('reaches the file a declared suite pins when the suite itself was edited', () => {
    // Weakening a test is a change to the claim the manifest makes. Without
    // this the source is untouched, nothing is selected, and the weaker suite
    // is first measured on somebody else's change.
    const reached = filesTouchedBy({
      changed: ['scripts/__tests__/audit-policy.test.ts'],
      manifest: SEED_MANIFEST,
    })
    expect(reached).toContain('scripts/audit-policy.ts')
  })

  it('does not reach a file whose suite was not the one edited', () => {
    const reached = filesTouchedBy({
      changed: ['scripts/__tests__/audit-policy.test.ts'],
      manifest: SEED_MANIFEST,
    })
    expect(reached).not.toContain('scripts/diff-coverage-policy.ts')
  })

  it('names a file once, however many of its suites were edited', () => {
    const manifest: Manifest = {
      graded: [{ file: 'src/a.ts', suites: ['t/one.test.ts', 't/two.test.ts'] }],
      equivalents: [],
    }
    const reached = filesTouchedBy({ changed: ['t/one.test.ts', 't/two.test.ts'], manifest })
    expect(reached.filter((file) => file === 'src/a.ts')).toHaveLength(1)
  })
})

describe('which files a change puts under mutation (B4)', () => {
  it('grades a touched file the manifest declares', () => {
    const selection = selectForChange({
      changed: ['scripts/audit-policy.ts', 'README.md'],
      manifest: SEED_MANIFEST,
    })
    expect(selection.graded.map((entry) => entry.file)).toEqual(['scripts/audit-policy.ts'])
    expect(selection.suites).toEqual(['scripts/__tests__/audit-policy.test.ts'])
  })

  it('leaves a manifest entry the change did not touch out of the run (B4)', () => {
    const selection = selectForChange({
      changed: ['scripts/audit-policy.ts'],
      manifest: SEED_MANIFEST,
    })
    expect(selection.graded.map((entry) => entry.file)).not.toContain(
      'scripts/diff-coverage-policy.ts'
    )
  })

  it('names a touched source file the manifest does not declare, rather than passing over it', () => {
    const selection = selectForChange({
      changed: ['apps/web/src/lib/server/auth/index.ts', 'scripts/audit-policy.ts'],
      manifest: SEED_MANIFEST,
    })
    expect(selection.notGraded).toEqual(['apps/web/src/lib/server/auth/index.ts'])
  })

  it('does not name a touched file that is not source at all', () => {
    const selection = selectForChange({
      changed: ['CLAUDE.md', 'package.json', '.github/workflows/ci.yml'],
      manifest: SEED_MANIFEST,
    })
    expect(selection.notGraded).toEqual([])
    expect(selection.graded).toEqual([])
  })

  it('does not name a test file as ungraded — a suite is not the code under test', () => {
    const selection = selectForChange({
      changed: ['scripts/__tests__/audit-policy.test.ts'],
      manifest: SEED_MANIFEST,
    })
    expect(selection.notGraded).toEqual([])
  })

  it('runs each declared suite once, however many files name it', () => {
    const manifest: Manifest = {
      graded: [
        { file: 'src/a.ts', suites: ['t/shared.test.ts', 't/a.test.ts'] },
        { file: 'src/b.ts', suites: ['t/shared.test.ts'] },
      ],
      equivalents: [],
    }
    const selection = selectForChange({ changed: ['src/a.ts', 'src/b.ts'], manifest })
    expect(selection.suites).toEqual(['t/a.test.ts', 't/shared.test.ts'])
  })
})

describe('what fails the gate (B5, B9)', () => {
  const source = ['const a = 1', 'if (a <= b) run()', 'done()']

  it('reports a survivor by file, line, mutator and the change that survived (B5)', () => {
    const verdict = gradeReport({
      report: reportOf('src/a.ts', source, [mutant({ status: 'Survived' })]),
      equivalents: [],
      notGraded: [],
    })
    expect(verdict.findings).toEqual([
      {
        file: 'src/a.ts',
        line: 2,
        mutator: 'EqualityOperator',
        replacement: 'a <= b',
        status: 'Survived',
      },
    ])
  })

  it('reports a mutant no selected suite executed, exactly like a survivor (B9)', () => {
    const verdict = gradeReport({
      report: reportOf('src/a.ts', source, [mutant({ status: 'NoCoverage' })]),
      equivalents: [],
      notGraded: [],
    })
    expect(verdict.findings).toHaveLength(1)
    expect(verdict.findings[0].status).toBe('NoCoverage')
  })

  it('treats a timeout as detected, not as a finding (B5)', () => {
    const verdict = gradeReport({
      report: reportOf('src/a.ts', source, [
        mutant({ status: 'Killed' }),
        mutant({ status: 'Timeout' }),
      ]),
      equivalents: [],
      notGraded: [],
    })
    expect(verdict.findings).toEqual([])
    expect(verdict.score).toBe(1)
  })

  it('scores over every mutant, not over the covered ones (B9)', () => {
    // The measured shape of sign-in-method-availability.ts: 58 killed, 5
    // survived, 30 never executed. Stryker prints 62.37 total / 92.06 covered,
    // and the gate has to grade on the first of those.
    const mutants = [
      ...Array.from({ length: 58 }, () => mutant({ status: 'Killed' })),
      ...Array.from({ length: 5 }, () => mutant({ status: 'Survived' })),
      ...Array.from({ length: 30 }, () => mutant({ status: 'NoCoverage' })),
    ]
    const verdict = gradeReport({
      report: reportOf('src/a.ts', source, mutants),
      equivalents: [],
      notGraded: [],
    })
    expect(verdict.counts).toMatchObject({ killed: 58, survived: 5, noCoverage: 30, total: 93 })
    expect(verdict.score).toBeCloseTo(0.6237, 4)
    expect(verdict.findings).toHaveLength(35)
  })

  it('counts a mutant that would not compile without failing on it', () => {
    const verdict = gradeReport({
      report: reportOf('src/a.ts', source, [
        mutant({ status: 'Killed' }),
        mutant({ status: 'CompileError' }),
      ]),
      equivalents: [],
      notGraded: [],
    })
    expect(verdict.findings).toEqual([])
    expect(verdict.counts.compileError).toBe(1)
    // Out of the score as well: an invalid mutant is not a test gap.
    expect(verdict.score).toBe(1)
  })

  it('passes a file whose every mutant died, and says so with a number', () => {
    const verdict = gradeReport({
      report: reportOf('src/a.ts', source, [mutant(), mutant()]),
      equivalents: [],
      notGraded: [],
    })
    expect(verdict.findings).toEqual([])
    expect(formatVerdict(verdict).join('\n')).toMatch(/2 mutant\(s\)/)
  })

  it('carries the ungraded files into the report, so the selection cannot shrink quietly', () => {
    const verdict = gradeReport({
      report: reportOf('src/a.ts', source, [mutant()]),
      equivalents: [],
      notGraded: ['src/undeclared.ts'],
    })
    expect(formatVerdict(verdict).join('\n')).toContain('src/undeclared.ts')
  })
})

describe('an equivalence record excuses one mutation and no more (B6)', () => {
  const source = ['const a = 1', 'if (a < b) run()', 'if (a < c) run()']
  const record: EquivalenceRecord = {
    file: 'src/a.ts',
    mutator: 'EqualityOperator',
    line: 'if (a < b) run()',
    replacement: 'a <= b',
    why: 'The two agree for every input this function can be handed.',
  }
  const survivor = mutant({
    status: 'Survived',
    replacement: 'a <= b',
    location: { start: { line: 2 } },
  })

  it('excuses the mutation it names', () => {
    const verdict = gradeReport({
      report: reportOf('src/a.ts', source, [survivor]),
      equivalents: [record],
      notGraded: [],
    })
    expect(verdict.findings).toEqual([])
    expect(verdict.counts.excused).toBe(1)
  })

  it('does not silence a different mutator on the same line', () => {
    const verdict = gradeReport({
      report: reportOf('src/a.ts', source, [
        mutant({ ...survivor, mutatorName: 'ConditionalExpression' }),
      ]),
      equivalents: [record],
      notGraded: [],
    })
    expect(verdict.findings).toHaveLength(1)
  })

  it('does not silence a different replacement of the same mutator', () => {
    const verdict = gradeReport({
      report: reportOf('src/a.ts', source, [mutant({ ...survivor, replacement: 'a > b' })]),
      equivalents: [record],
      notGraded: [],
    })
    expect(verdict.findings).toHaveLength(1)
  })

  it('does not silence the same mutation on a different line', () => {
    // Line 3 is `if (a < c)`: same mutator, same shape, a different place.
    const verdict = gradeReport({
      report: reportOf('src/a.ts', source, [
        mutant({ ...survivor, location: { start: { line: 3 } }, replacement: 'a <= c' }),
      ]),
      equivalents: [record],
      notGraded: [],
    })
    expect(verdict.findings).toHaveLength(1)
  })

  it('stops excusing once the line it was written for has changed', () => {
    // The record is addressed by the text of the line, not by its number, so
    // editing the line retires the record instead of moving it silently onto
    // whatever the edit produced.
    const edited = ['const a = 1', 'if (a < b && ready) run()', 'if (a < c) run()']
    const verdict = gradeReport({
      report: reportOf('src/a.ts', edited, [survivor]),
      equivalents: [record],
      notGraded: [],
    })
    expect(verdict.findings).toHaveLength(1)
  })

  it('follows the line it names when the line moves', () => {
    // The complement of the test above: an insertion above the line must not
    // retire a record that still describes the same code.
    const shifted = ['const a = 1', 'const ready = true', 'if (a < b) run()']
    const verdict = gradeReport({
      report: reportOf('src/a.ts', shifted, [
        mutant({ ...survivor, location: { start: { line: 3 } } }),
      ]),
      equivalents: [record],
      notGraded: [],
    })
    expect(verdict.findings).toEqual([])
  })

  it('ignores leading indentation, which is a formatter decision', () => {
    const indented = ['const a = 1', '    if (a < b) run()', 'if (a < c) run()']
    const verdict = gradeReport({
      report: reportOf('src/a.ts', indented, [survivor]),
      equivalents: [record],
      notGraded: [],
    })
    expect(verdict.findings).toEqual([])
  })

  it('reports a record that excused nothing in a file this run graded', () => {
    const verdict = gradeReport({
      report: reportOf('src/a.ts', source, [mutant({ status: 'Killed' })]),
      equivalents: [record],
      notGraded: [],
    })
    expect(verdict.stale).toEqual([record])
  })

  it('does not call a record stale when its file was not in this run', () => {
    // Only the touched files are mutated, so most records are simply not
    // exercised. Calling those stale would train everyone to ignore the list.
    const verdict = gradeReport({
      report: reportOf('src/other.ts', source, [mutant()]),
      equivalents: [record],
      notGraded: [],
    })
    expect(verdict.stale).toEqual([])
  })
})

describe('a manifest that cannot be trusted is not read (B4, B6)', () => {
  const valid = {
    graded: [{ file: 'src/a.ts', suites: ['t/a.test.ts'] }],
    equivalents: [{ file: 'src/a.ts', mutator: 'M', line: 'x', replacement: 'y', why: 'because' }],
  }

  it('reads a manifest whose entries are all complete', () => {
    expect(readManifest(valid)).toEqual(valid)
  })

  it('refuses anything that is not a manifest', () => {
    for (const value of [null, 42, 'text', {}, { graded: [] }, { equivalents: [] }]) {
      expect(() => readManifest(value)).toThrow(/graded.*equivalents/)
    }
  })

  it('refuses an entry without a file or without suites', () => {
    for (const entry of [
      {},
      { file: 'src/a.ts' },
      { suites: ['t/a.test.ts'] },
      { file: 3, suites: [] },
    ]) {
      expect(() => readManifest({ ...valid, graded: [entry] })).toThrow(/file.*suites/)
    }
  })

  it('refuses an entry that declares no suite at all', () => {
    // An entry with an empty suite list would mutate the file and run nothing,
    // which reads as every mutant surviving.
    expect(() => readManifest({ ...valid, graded: [{ file: 'src/a.ts', suites: [] }] })).toThrow(
      /at least one suite/
    )
    expect(() => readManifest({ ...valid, graded: [{ file: 'src/a.ts', suites: [7] }] })).toThrow(
      /at least one suite/
    )
  })

  it('refuses an equivalence record with a field missing', () => {
    const complete = valid.equivalents[0]
    for (const field of ['file', 'mutator', 'line', 'replacement', 'why']) {
      const record: Record<string, unknown> = { ...complete }
      delete record[field]
      expect(() => readManifest({ ...valid, equivalents: [record] }), field).toThrow(
        /an equivalence record needs/
      )
    }
  })

  it('refuses an equivalence record whose reason is blank', () => {
    // The reason is the whole content of a record: it is the argument that no
    // test could catch the mutant. A blank one is an allowlist entry.
    expect(() =>
      readManifest({ ...valid, equivalents: [{ ...valid.equivalents[0], why: '   ' }] })
    ).toThrow(/needs a reason/)
  })
})

describe('a run that measured nothing is not a pass (B7)', () => {
  it('refuses something that parses but is not a mutation report', () => {
    for (const value of [null, 42, 'a string', {}, { files: 3 }, { files: { 'a.ts': {} } }]) {
      const measurement = readMeasurement(value)
      expect(measurement.measured).toBe(false)
    }
  })

  it('refuses a report that names no mutated file', () => {
    const measurement = readMeasurement({ files: {}, testFiles: {} })
    expect(measurement.measured).toBe(false)
    expect(measurement.measured === false && measurement.reason).toMatch(/no file/i)
  })

  it('refuses a report whose run executed no test at all', () => {
    // The shape a misspelled or renamed suite produces: vitest matches nothing,
    // every mutant survives, and the run reads as a catastrophic finding rather
    // than as a selection that pointed at nothing.
    const measurement = readMeasurement({
      files: { 'src/a.ts': { source: 'const a = 1', mutants: [mutant({ status: 'Survived' })] } },
      testFiles: {},
    })
    expect(measurement.measured).toBe(false)
    expect(measurement.measured === false && measurement.reason).toMatch(/no test/i)
  })

  it('accepts a report that mutated a file and ran a test', () => {
    const measurement = readMeasurement(reportOf('src/a.ts', ['const a = 1'], [mutant()]))
    expect(measurement.measured).toBe(true)
  })
})

describe('properties', () => {
  const statusArb = fc.constantFrom(
    'Killed',
    'Survived',
    'NoCoverage',
    'Timeout',
    'CompileError',
    'RuntimeError'
  )

  it('accounts for every mutant exactly once, whatever the mix (B5, B9)', () => {
    // The unguarded conservation law: a mutant is either a finding, excused,
    // detected, or one of the statuses the score leaves out. No branch of the
    // grading may drop one or count one twice.
    fc.assert(
      fc.property(fc.array(statusArb, { maxLength: 40 }), (statuses) => {
        const mutants = statuses.map((status) => mutant({ status }))
        const verdict = gradeReport({
          report: reportOf('src/a.ts', ['const a = 1', 'if (a <= b) run()'], mutants),
          equivalents: [],
          notGraded: [],
        })
        const { counts } = verdict
        expect(
          counts.killed +
            counts.timeout +
            counts.survived +
            counts.noCoverage +
            counts.compileError +
            counts.other
        ).toBe(statuses.length)
        expect(verdict.findings.length + counts.excused).toBe(counts.survived + counts.noCoverage)
      })
    )
  })

  it('never lets a record that matches nothing change the verdict (B6)', () => {
    // Non-interference: the fields a record is addressed by are the only thing
    // that can excuse a mutant. Rewriting the prose, or naming a file, mutator
    // or replacement that does not occur, leaves the findings exactly as they
    // were.
    fc.assert(
      fc.property(
        fc.array(statusArb, { minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (statuses, otherFile, prose) => {
          const mutants = statuses.map((status) => mutant({ status }))
          const source = ['const a = 1', 'if (a <= b) run()']
          const bare = gradeReport({
            report: reportOf('src/a.ts', source, mutants),
            equivalents: [],
            notGraded: [],
          })
          const withRecord = gradeReport({
            report: reportOf('src/a.ts', source, mutants),
            equivalents: [
              {
                file: `src/${otherFile}-not-here.ts`,
                mutator: 'EqualityOperator',
                line: 'if (a <= b) run()',
                replacement: 'a <= b',
                why: prose,
              },
            ],
            notGraded: [],
          })
          expect(withRecord.findings).toEqual(bare.findings)
          expect(withRecord.score).toBe(bare.score)
        }
      )
    )
  })

  it('scores a run no lower for killing one more mutant (B9)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('Survived', 'NoCoverage'), { minLength: 1, maxLength: 20 }),
        (statuses) => {
          const source = ['const a = 1', 'if (a <= b) run()']
          const before = gradeReport({
            report: reportOf(
              'src/a.ts',
              source,
              statuses.map((status) => mutant({ status }))
            ),
            equivalents: [],
            notGraded: [],
          })
          const killedOne = ['Killed', ...statuses.slice(1)]
          const after = gradeReport({
            report: reportOf(
              'src/a.ts',
              source,
              killedOne.map((status) => mutant({ status }))
            ),
            equivalents: [],
            notGraded: [],
          })
          expect(after.score).toBeGreaterThan(before.score)
          expect(after.findings.length).toBe(before.findings.length - 1)
        }
      )
    )
  })

  it('selects no file the change did not touch, whatever the manifest holds (B4)', () => {
    const pathArb = fc.stringMatching(/^[a-z]{1,8}$/).map((name) => `src/${name}.ts`)
    fc.assert(
      fc.property(
        fc.uniqueArray(pathArb, { maxLength: 8 }),
        fc.uniqueArray(pathArb, { maxLength: 8 }),
        (declared, changed) => {
          const manifest: Manifest = {
            graded: declared.map((file) => ({ file, suites: [`t/${file}.test.ts`] })),
            equivalents: [],
          }
          const selection = selectForChange({ changed, manifest })
          for (const entry of selection.graded) {
            expect(changed).toContain(entry.file)
            expect(declared).toContain(entry.file)
          }
          // Every touched source file is accounted for: graded or named.
          const seen = [...selection.graded.map((entry) => entry.file), ...selection.notGraded]
          expect([...seen].sort()).toEqual([...changed].sort())
        }
      )
    )
  })
})
