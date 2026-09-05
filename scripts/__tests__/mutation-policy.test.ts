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
 * B10 Two runs of the same commit reach the same verdict. Every setting of the
 *    run is stated by the gate rather than inherited, the runner is never asked
 *    to change the working copy, and it is never asked for work this repository
 *    does not need — a verdict that depends on the machine it ran on is not a
 *    measurement.
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
 * B10 was added after the gate contradicted itself: the same tree passed on one
 * CI runner and failed on the next with `ts.parseConfigFileTextToJson is not a
 * function`, thrown while Stryker rewrote a tsconfig it did not need to rewrite.
 * The two runners differed in a Node patch version, and that rewrite reads the
 * TypeScript compiler through CommonJS interop. Nothing about the code under
 * test had changed, so whatever the second run measured, it was not this
 * repository. A gate whose verdict can turn on the machine underneath is worth
 * less than no gate, because it is believed.
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
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  dryRunTests,
  filesTouchedBy,
  formatVerdict,
  gradeReport,
  readManifest,
  readMeasurement,
  selectForChange,
  strykerConfigFor,
  type EquivalenceRecord,
  type Manifest,
  type Mutant,
  type MutationReport,
} from '../mutation-policy'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

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

  it('reaches the file when only one of its several suites was edited', () => {
    // Each suite in an entry is part of the same claim, so editing any one of
    // them re-opens it.
    const manifest: Manifest = {
      graded: [{ file: 'src/a.ts', suites: ['t/one.test.ts', 't/two.test.ts'] }],
      equivalents: [],
    }
    expect(filesTouchedBy({ changed: ['t/two.test.ts'], manifest })).toContain('src/a.ts')
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
      changed: [
        'scripts/__tests__/audit-policy.test.ts',
        // Not in a `__tests__` directory, so only the suffix rules it out.
        'src/thing.test.ts',
        'src/thing.test.tsx',
        // In one, but not itself a suite: a fixture or a helper.
        'src/__tests__/helpers.ts',
      ],
      manifest: SEED_MANIFEST,
    })
    expect(selection.notGraded).toEqual([])
  })

  it('does not name a declaration file, which holds no behaviour to mutate', () => {
    const selection = selectForChange({ changed: ['src/types.d.ts'], manifest: SEED_MANIFEST })
    expect(selection.notGraded).toEqual([])
  })

  it('names a component as ungraded, the same as any other source', () => {
    const selection = selectForChange({ changed: ['src/Widget.tsx'], manifest: SEED_MANIFEST })
    expect(selection.notGraded).toEqual(['src/Widget.tsx'])
  })

  it('names what it did not grade in a stable order', () => {
    // The report is read by people and diffed by machines; an order that
    // depends on how git happened to list the change is neither.
    const selection = selectForChange({
      changed: ['src/z.ts', 'src/a.ts', 'src/m.ts'],
      manifest: SEED_MANIFEST,
    })
    expect(selection.notGraded).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts'])
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
    expect(verdict.counts.timeout).toBe(1)
    expect(verdict.score).toBe(1)
  })

  it('counts a status the score leaves out without failing on it', () => {
    // A runner error is not a suite's fault and not a mutant that got away.
    // Counting it as either would make the score say something it does not know.
    const verdict = gradeReport({
      report: reportOf('src/a.ts', source, [
        mutant({ status: 'Killed' }),
        mutant({ status: 'RuntimeError' }),
        mutant({ status: 'Ignored' }),
      ]),
      equivalents: [],
      notGraded: [],
    })
    expect(verdict.findings).toEqual([])
    expect(verdict.counts.other).toBe(2)
    expect(verdict.score).toBe(1)
  })

  it('scores a run whose every mutant the score leaves out as measured, not as NaN', () => {
    const verdict = gradeReport({
      report: reportOf('src/a.ts', source, [mutant({ status: 'CompileError' })]),
      equivalents: [],
      notGraded: [],
    })
    expect(verdict.score).toBe(1)
  })

  it('counts a timeout towards the score, not against it', () => {
    // 1 killed and 1 timeout are both detections, against 2 that got away.
    const verdict = gradeReport({
      report: reportOf('src/a.ts', source, [
        mutant({ status: 'Killed' }),
        mutant({ status: 'Timeout' }),
        mutant({ status: 'Survived' }),
        mutant({ status: 'NoCoverage' }),
      ]),
      equivalents: [],
      notGraded: [],
    })
    expect(verdict.score).toBe(0.5)
  })

  it('reports findings in a stable order across files', () => {
    const verdict = gradeReport({
      report: {
        files: {
          'src/z.ts': { source: source.join('\n'), mutants: [mutant({ status: 'Survived' })] },
          'src/a.ts': { source: source.join('\n'), mutants: [mutant({ status: 'Survived' })] },
        },
        testFiles: { 'some.test.ts': { tests: [{}] } },
      },
      equivalents: [],
      notGraded: [],
    })
    expect(verdict.findings.map((finding) => finding.file)).toEqual(['src/a.ts', 'src/z.ts'])
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
    // And it is not also reported stale: a record that did its work is not a
    // record whose line has gone.
    expect(verdict.stale).toEqual([])
  })

  it('excuses a record whose line was written down with its indentation', () => {
    const indented = { ...record, line: '      if (a < b) run()' }
    const verdict = gradeReport({
      report: reportOf('src/a.ts', source, [survivor]),
      equivalents: [indented],
      notGraded: [],
    })
    expect(verdict.findings).toEqual([])
  })

  it('excuses nothing for a mutant whose line is not in the source at all', () => {
    // A report and a checkout that disagree — a stale report, a file that
    // shrank. The mutant is a finding, and reading past the end of the source
    // is not a way to decide otherwise.
    const verdict = gradeReport({
      report: reportOf('src/a.ts', source, [
        mutant({ ...survivor, location: { start: { line: 99 } } }),
      ]),
      equivalents: [record],
      notGraded: [],
    })
    expect(verdict.findings).toHaveLength(1)
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
    // Every suite has to be a name, not merely one of them: a list with a
    // stray number in it would be handed to vitest as an include pattern.
    expect(() =>
      readManifest({ ...valid, graded: [{ file: 'src/a.ts', suites: ['t/a.test.ts', 7] }] })
    ).toThrow(/at least one suite/)
  })

  it('refuses an equivalence record that is not an object at all', () => {
    // Says what is wrong rather than failing while taking the record apart.
    for (const record of [null, 'a line of prose', 42, ['file', 'mutator']]) {
      expect(() => readManifest({ ...valid, equivalents: [record] })).toThrow(
        /an equivalence record needs/
      )
    }
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
    for (const value of [null, 42, 'a string', {}, { files: 3 }]) {
      const measurement = readMeasurement(value)
      expect(measurement.measured).toBe(false)
      expect(measurement.measured === false && measurement.reason).toMatch(/not a report/i)
    }
  })

  it('refuses a report whose entry for a file carries no mutants', () => {
    // Checked before the test count, and reported by naming the file: this is
    // the shape a report truncated mid-write has, and "no test ran" would send
    // whoever reads it to the wrong place.
    const ranATest = { testFiles: { 'some.test.ts': { tests: [{ id: '1' }] } } }
    for (const entry of [
      {},
      'not an object',
      { source: 'const a = 1' },
      { mutants: [] },
      { source: 3, mutants: [] },
      { source: 'const a = 1', mutants: 'not an array' },
    ]) {
      const measurement = readMeasurement({ files: { 'src/a.ts': entry }, ...ranATest })
      expect(measurement.measured, JSON.stringify(entry)).toBe(false)
      expect(measurement.measured === false && measurement.reason).toMatch(
        /entry for src\/a\.ts has no source and mutants/
      )
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

  it('counts the tests the dry run found, across every suite', () => {
    // The number itself, not just whether it is zero: it is what separates a
    // selection that pointed at nothing from one that ran.
    expect(
      dryRunTests({
        files: {},
        testFiles: {
          'a.test.ts': { tests: [{}, {}, {}] },
          'b.test.ts': { tests: [{}, {}] },
        },
      })
    ).toBe(5)
    expect(dryRunTests({ files: {} })).toBe(0)
  })
})

describe('the report a run prints (B5, B9)', () => {
  // Asserted in full rather than by substring. The report is the whole
  // interface of this gate: it is what a pull request shows, and what somebody
  // reads at the point where they have to decide whether a mutant matters. A
  // number quietly dropped from it, a blank line that stops separating the
  // sections, or a section that stops being printed, is the same class of
  // failure as grading less.
  //
  // Built inside each test, never in this describe body. A mutant that crashes
  // a fixture at collection time makes vitest report zero tests, and Stryker
  // reads zero failing tests as a mutant that survived — under-reporting in
  // the reassuring direction. Measured here: it cost one run of this gate
  // against itself.
  function reportedVerdict() {
    return gradeReport({
      report: reportOf(
        'src/a.ts',
        ['const a = 1', 'if (a <= b) run()'],
        [
          mutant({ status: 'Killed' }),
          mutant({ status: 'Survived', location: { start: { line: 2 } } }),
          // A different line and a different mutator, so that the report has
          // to pair each mutant with its own status rather than merely print
          // both words somewhere.
          mutant({
            status: 'NoCoverage',
            mutatorName: 'StringLiteral',
            replacement: '""',
            location: { start: { line: 1 } },
          }),
        ]
      ),
      equivalents: [
        {
          file: 'src/a.ts',
          mutator: 'EqualityOperator',
          replacement: 'a <= b',
          // The line the record was written for is not in the source any more.
          line: 'if (a < b) run()',
          why: 'Written for a line that has since been rewritten.',
        },
      ],
      notGraded: ['src/undeclared.ts'],
    })
  }

  it('prints what was graded, what got away, and what excused nothing', () => {
    expect(formatVerdict(reportedVerdict())).toEqual([
      'Mutated (the files this change touched that the manifest declares): 1 file(s), 3 mutant(s) \u2014 1 killed, 0 killed by timeout, 1 survived, 1 never executed.',
      'Score over every mutant: 33.33% (0 excused as equivalent, 0 did not compile, 0 neither).',
      'Not mutation-graded (touched, but no entry in the manifest): 1 file(s).',
      '',
      'Mutants the tests did not catch:',
      '  - src/a.ts:2 EqualityOperator -> a <= b (survived)',
      '  - src/a.ts:1 StringLiteral -> "" (never executed)',
      '',
      'Not mutation-graded, although they look like source:',
      '  - src/undeclared.ts',
      '',
      'Equivalence records that excused nothing \u2014 the line they name has changed:',
      '  - src/a.ts: EqualityOperator -> a <= b on `if (a < b) run()`',
    ])
  })

  it('prints no empty section when there is nothing to put in it', () => {
    const clean = gradeReport({
      report: reportOf('src/a.ts', ['const a = 1'], [mutant({ status: 'Killed' })]),
      equivalents: [],
      notGraded: [],
    })
    const printed = formatVerdict(clean)
    expect(printed).toHaveLength(3)
    expect(printed.join('\n')).not.toMatch(/did not catch|although they look|excused nothing/)
  })
})

describe('the Stryker run the gate asks for (B10)', () => {
  function generated() {
    return strykerConfigFor({
      mutate: ['scripts/mutation-policy.ts'],
      vitestConfigFile: '.mutation-tmp/run.vitest.config.ts',
      reportFile: '.mutation-tmp/report.json',
      tempDirName: '.mutation-tmp/stryker',
    })
  }

  it('states every setting, so none is decided somewhere else (B10)', () => {
    expect(generated()).toEqual({
      packageManager: 'npm',
      testRunner: 'vitest',
      plugins: ['@stryker-mutator/vitest-runner'],
      vitest: { configFile: '.mutation-tmp/run.vitest.config.ts' },
      mutate: ['scripts/mutation-policy.ts'],
      coverageAnalysis: 'perTest',
      reporters: ['clear-text', 'json'],
      jsonReporter: { fileName: '.mutation-tmp/report.json' },
      timeoutMS: 60000,
      dryRunTimeoutMinutes: 5,
      concurrency: 4,
      thresholds: { break: null },
      tempDirName: '.mutation-tmp/stryker',
      tsconfigFile: '.mutation-tmp/no-tsconfig-to-rewrite.json',
      inPlace: false,
    })
  })

  it('asks for no tsconfig rewrite, which this repository does not need (B10)', () => {
    // Stryker rewrites the tsconfig it is pointed at, and that code path
    // imports the TypeScript compiler in a way whose result depends on the
    // Node build it runs under — it failed one CI run and passed the one
    // before it on the same tree. This repository needs the rewrite for
    // nothing: it exists for `extends` and `references` paths that fall
    // outside the sandbox, every tsconfig here extends a path inside the
    // repository, and the root one extends nothing at all.
    const named = generated().tsconfigFile
    expect(existsSync(path.join(repoRoot, named))).toBe(false)
  })

  it('never asks the runner to change the working copy (B10)', () => {
    // `inPlace` would make Stryker edit the working tree instead of a
    // sandbox copy, and a crashed run would leave mutants in it. It is also
    // the other way to skip the tsconfig rewrite, and the wrong one.
    expect(generated().inPlace).toBe(false)
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
