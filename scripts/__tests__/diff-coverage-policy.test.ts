/**
 * The diff-coverage gate's policy, as guarantees rather than as code.
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
 *
 * The confirmed list is above in full. B4, B5 and B6 are the mutation half and
 * are deliberately untested here — this module has no mutation runner in it.
 * They are not gaps in the list; they are the second half of the same contract,
 * and they stay written down so nobody re-derives a shorter one.
 *
 * Of the coverage half, B8 is the only guarantee this module cannot hold: a
 * merge base is a git question, and the policy never touches git. It is tested
 * against the real gate in `diff-coverage-gate.test.ts`, on a throwaway
 * repository whose branch has moved on.
 *
 * Measured on 2026-09-04 with `bun x stryker run`: line coverage of
 * `diff-coverage-policy.ts` 100% (84/84 lines, 101/101 statements, 53/53
 * branches, 13/13 functions), mutation score 98.91% — 183 mutants, 180 killed,
 * 1 timeout (an infinite loop, so detected on any machine), 2 survivors. Both
 * survivors are equivalent mutants, and here is why:
 *
 *   - `best < count` → `best <= count` in `executionsPerLine`. The two differ
 *     only when the counts are equal, and then the mutant overwrites the entry
 *     with the value it already held. No input can tell them apart.
 *   - `.join(',')` → `.join('')` in `statementLayout`. Every entry is written
 *     `<id>:<line>` and a line number cannot contain a colon, so the `<id>:`
 *     markers already separate the entries unambiguously. The comma carries no
 *     information the string does not have without it.
 *
 * What that number covers: this module, against this suite. It says nothing
 * about `diff-coverage-check.ts`, which runs as a spawned bun process where
 * neither the coverage provider nor the mutation runner can observe it — that
 * one is covered end to end by `diff-coverage-gate.test.ts`, and the gate
 * reports every file it could not grade rather than passing over it.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  formatVerdict,
  grade,
  isCoverageReport,
  mergeReports,
  parseAddedLines,
  type CoverageReport,
  type FileCoverage,
} from '../diff-coverage-policy'

/**
 * One file's coverage, written as `[line, times it ran]` per statement.
 *
 * Every fixture is built inside the test that uses it. A call out here would
 * run while vitest is still collecting the file, and a fault in the code under
 * test would then take the whole suite down before a single test ran — which
 * reads as "nothing failed" and scores a mutant as survived.
 */
function fileCoverage(path: string, statements: Array<[number, number]>): FileCoverage {
  const statementMap: FileCoverage['statementMap'] = {}
  const counts: FileCoverage['s'] = {}
  statements.forEach(([line, count], index) => {
    statementMap[String(index)] = { start: { line } }
    counts[String(index)] = count
  })
  return { path, statementMap, s: counts }
}

function report(...files: FileCoverage[]): CoverageReport {
  const out: CoverageReport = {}
  for (const file of files) out[file.path] = file
  return out
}

/** A unified diff with zero context, the way `git diff -U0` prints one. */
function diffOf(files: Array<{ path: string; hunks: Array<{ from: number; added: number }> }>) {
  const lines: string[] = []
  for (const file of files) {
    lines.push(`diff --git a/${file.path} b/${file.path}`)
    lines.push(`--- a/${file.path}`)
    lines.push(`+++ b/${file.path}`)
    for (const hunk of file.hunks) {
      lines.push(`@@ -${hunk.from},0 +${hunk.from},${hunk.added} @@`)
      for (let n = 0; n < hunk.added; n += 1) lines.push(`+a line`)
    }
  }
  return lines.join('\n')
}

describe('reading a diff (B1)', () => {
  it('takes the added lines from the new-side hunk range', () => {
    const diff = diffOf([{ path: 'src/a.ts', hunks: [{ from: 12, added: 3 }] }])

    expect(parseAddedLines(diff)).toEqual({ 'src/a.ts': [12, 13, 14] })
  })

  it('reads a hunk that omits its length as one line', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -4 +5 @@',
      '+one',
    ].join('\n')

    expect(parseAddedLines(diff)).toEqual({ 'src/a.ts': [5] })
  })

  it('reports nothing for a hunk that only deletes', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -7,2 +6,0 @@',
      '-gone',
      '-gone',
    ].join('\n')

    expect(parseAddedLines(diff)).toEqual({})
  })

  it('skips a deleted file, which has no new side to judge', () => {
    const diff = [
      'diff --git a/src/gone.ts b/src/gone.ts',
      '--- a/src/gone.ts',
      '+++ /dev/null',
      '@@ -1,3 +0,0 @@',
      '-a',
      '-b',
      '-c',
    ].join('\n')

    expect(parseAddedLines(diff)).toEqual({})
  })

  it('keeps a path that contains a space', () => {
    const diff = diffOf([{ path: 'src/two words.ts', hunks: [{ from: 1, added: 1 }] }])

    expect(parseAddedLines(diff)).toEqual({ 'src/two words.ts': [1] })
  })

  it('attributes nothing to a hunk that arrives before any file header', () => {
    // There is no file to attribute those lines to. Guessing would put them
    // under an empty path, which grades as an out-of-scope file and is how a
    // truncated diff would come out looking clean.
    const diff = ['@@ -0,0 +1,2 @@', '+one', '+two'].join('\n')

    expect(parseAddedLines(diff)).toEqual({})
  })

  it('attributes nothing to a diff whose beginning was cut off', () => {
    // A `+++ ` line with no `--- ` line above it is not a file header, it is
    // the middle of something. Reading it as one would attribute the hunks
    // that follow to a file, and a truncated diff would grade as clean.
    const diff = ['+++ b/src/a.ts', '@@ -0,0 +1,2 @@', '+one', '+two'].join('\n')

    expect(parseAddedLines(diff)).toEqual({})
  })

  it('does not mistake a removed comment line for the old-side header', () => {
    // A removed SQL comment `-- note` arrives as `--- note`, which is a
    // `--- ` header to the naked eye. The migrations in this repository are
    // hand-written SQL full of such comments, so this is the shape a real
    // change produces — and taking the line after it as a file header moves
    // every following hunk onto a file that does not exist.
    const diff = [
      'diff --git a/packages/db/drizzle/0249_x.sql b/packages/db/drizzle/0249_x.sql',
      '--- a/packages/db/drizzle/0249_x.sql',
      '+++ b/packages/db/drizzle/0249_x.sql',
      '@@ -1,1 +1,1 @@',
      '--- an old note',
      '+-- a new note',
      '@@ -9,0 +10,1 @@',
      '+INSERT INTO t VALUES (1);',
    ].join('\n')

    expect(parseAddedLines(diff)).toEqual({
      'packages/db/drizzle/0249_x.sql': [1, 10],
    })
  })

  it('reads a hunk header that carries the enclosing function name', () => {
    // git appends the enclosing context to the header, with -U0 as well.
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -12,0 +13,1 @@ export function grade(input: Input) {',
      '+one',
    ].join('\n')

    expect(parseAddedLines(diff)).toEqual({ 'src/a.ts': [13] })
  })

  it('reads a hunk whose length has more than one digit', () => {
    const diff = diffOf([{ path: 'src/a.ts', hunks: [{ from: 5, added: 12 }] }])

    const added = parseAddedLines(diff)

    expect(added['src/a.ts']).toHaveLength(12)
    expect(added['src/a.ts'][11]).toBe(16)
  })

  it('does not mistake an added line for a file header', () => {
    // A source line that itself starts with `++ ` arrives in the diff as
    // `+++ …`, which is a file header to the naked eye. In a unified diff a
    // file header is always the line after a `--- ` header, and this repository
    // has test fixtures full of diff text, so the case is not hypothetical.
    // The fake header sits between two hunks, so mistaking it for a real one
    // moves the *second* hunk onto a file this change never touched. With the
    // fake header last, the misparse would have no visible effect and the test
    // would pass while the bug was there.
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -0,0 +1,1 @@',
      '+++ b/somewhere/else.ts',
      '@@ -40,0 +41,1 @@',
      '+second',
    ].join('\n')

    expect(parseAddedLines(diff)).toEqual({ 'src/a.ts': [1, 41] })
  })

  it('does not mistake an added line for a hunk header', () => {
    // Same shape, one line further in: an added source line whose text is a
    // hunk header. The `+` prefix is the only thing that says which it is.
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -0,0 +1,2 @@',
      '+@@ -99,0 +99,9 @@',
      '+second',
    ].join('\n')

    expect(parseAddedLines(diff)).toEqual({ 'src/a.ts': [1, 2] })
  })

  it('reads a header written without the a/ and b/ prefixes', () => {
    // `git diff --no-prefix`, and the `diff.noprefix` config that turns it on
    // for everything, both write the path bare.
    const diff = [
      'diff --git src/a.ts src/a.ts',
      '--- src/a.ts',
      '+++ src/a.ts',
      '@@ -0,0 +1,2 @@',
      '+one',
      '+two',
    ].join('\n')

    expect(parseAddedLines(diff)).toEqual({ 'src/a.ts': [1, 2] })
  })

  it('contributes nothing for a hunk header it cannot read', () => {
    // A combined diff, as `git diff -c` writes one for a merge. The gate never
    // asks git for this shape; a header it cannot read is skipped rather than
    // guessed at, which is why the gate and not the parser decides what
    // "nothing was measured" means.
    const diff = [
      'diff --combined src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@@ -1,2 -1,2 +1,2 @@@',
      '+ one',
    ].join('\n')

    expect(parseAddedLines(diff)).toEqual({})
  })

  it('collects every hunk of a file, and every file of a diff', () => {
    const diff = diffOf([
      {
        path: 'src/a.ts',
        hunks: [
          { from: 3, added: 1 },
          { from: 40, added: 2 },
        ],
      },
      { path: 'src/b.ts', hunks: [{ from: 9, added: 1 }] },
    ])

    expect(parseAddedLines(diff)).toEqual({ 'src/a.ts': [3, 40, 41], 'src/b.ts': [9] })
  })
})

describe('grading the added lines (B1, B2, B3)', () => {
  it('fails on an added line that no test executed, naming file and line (B2)', () => {
    const coverage = report(
      fileCoverage('src/a.ts', [
        [10, 1],
        [11, 0],
      ])
    )

    const verdict = grade({ added: { 'src/a.ts': [10, 11] }, coverage })

    expect(verdict.uncovered).toEqual([{ file: 'src/a.ts', line: 11 }])
  })

  it('names every uncovered line, across files (B2)', () => {
    const coverage = report(
      fileCoverage('src/a.ts', [
        [1, 0],
        [2, 0],
      ]),
      fileCoverage('src/b.ts', [[5, 0]])
    )

    const verdict = grade({
      added: { 'src/a.ts': [1, 2], 'src/b.ts': [5] },
      coverage,
    })

    expect(verdict.uncovered).toEqual([
      { file: 'src/a.ts', line: 1 },
      { file: 'src/a.ts', line: 2 },
      { file: 'src/b.ts', line: 5 },
    ])
  })

  it('ignores an uncovered line the change never touched (B1)', () => {
    const coverage = report(
      fileCoverage('src/a.ts', [
        [10, 1],
        [99, 0],
      ])
    )

    const verdict = grade({ added: { 'src/a.ts': [10] }, coverage })

    expect(verdict.uncovered).toEqual([])
    expect(verdict.judged).toEqual({ files: 1, lines: 1 })
  })

  it('counts a line covered when any statement starting on it ran', () => {
    // Two statements share line 7 — a short `if (x) return y` is enough. The
    // line ran, so it is covered; taking the first statement instead of the
    // best would report it as a hole.
    const coverage = report(
      fileCoverage('src/a.ts', [
        [7, 0],
        [7, 3],
      ])
    )

    const verdict = grade({ added: { 'src/a.ts': [7] }, coverage })

    expect(verdict.uncovered).toEqual([])
    expect(verdict.covered).toBe(1)
  })

  it('takes the highest count on a line, whichever statement came first', () => {
    // The reverse of the case above: the statement that ran is listed first.
    // Taking the last one seen, or overwriting on every statement, would report
    // a line that ran as a hole.
    const coverage = report(
      fileCoverage('src/a.ts', [
        [7, 3],
        [7, 0],
      ])
    )

    const verdict = grade({ added: { 'src/a.ts': [7] }, coverage })

    expect(verdict.uncovered).toEqual([])
    expect(verdict.covered).toBe(1)
  })

  it('reports files in a stable order, whatever order they arrived in', () => {
    const coverage = report(fileCoverage('src/a.ts', [[1, 0]]), fileCoverage('src/b.ts', [[1, 0]]))

    const verdict = grade({ added: { 'src/b.ts': [1], 'src/a.ts': [1] }, coverage })

    expect(verdict.uncovered).toEqual([
      { file: 'src/a.ts', line: 1 },
      { file: 'src/b.ts', line: 1 },
    ])
  })

  it('reports the lines of a file in ascending order', () => {
    const coverage = report(
      fileCoverage('src/a.ts', [
        [3, 0],
        [7, 0],
        [11, 0],
      ])
    )

    const verdict = grade({ added: { 'src/a.ts': [11, 3, 7] }, coverage })

    expect(verdict.uncovered).toEqual([
      { file: 'src/a.ts', line: 3 },
      { file: 'src/a.ts', line: 7 },
      { file: 'src/a.ts', line: 11 },
    ])
  })

  it('passes a change whose added lines carry no statement at all (B3)', () => {
    // Comments, blank lines, a type alias: nothing to execute, nothing to
    // demand a test for, and no exemption written anywhere.
    const coverage = report(fileCoverage('src/a.ts', [[10, 1]]))

    const verdict = grade({ added: { 'src/a.ts': [2, 3, 4] }, coverage })

    expect(verdict.uncovered).toEqual([])
    expect(verdict.notExecutable).toBe(3)
  })

  it('passes a change that added no lines at all (B3)', () => {
    const verdict = grade({ added: {}, coverage: {} })

    expect(verdict.uncovered).toEqual([])
    expect(verdict.judged).toEqual({ files: 0, lines: 0 })
  })

  it('leaves a file the coverage configuration does not include out of scope (B7)', () => {
    const verdict = grade({
      added: { 'README.md': [1], 'src/a.ts': [4] },
      coverage: report(fileCoverage('src/a.ts', [[4, 1]])),
    })

    expect(verdict.uncovered).toEqual([])
    expect(verdict.outOfScope.files).toBe(1)
  })

  it('names an out-of-scope file that looks like source, and only counts the rest (B7)', () => {
    // The failure this exists for: a coverage `include` that quietly stops
    // matching a source file turns the gate into a pass that graded nothing.
    // A `.md` file out of scope is normal and stays a number.
    const verdict = grade({
      added: { 'README.md': [1], 'docs/x.mdx': [2], 'src/new.ts': [3], 'src/new.tsx': [4] },
      coverage: {},
    })

    expect(verdict.outOfScope.named).toEqual(['src/new.ts', 'src/new.tsx'])
    expect(verdict.outOfScope.unnamed).toBe(2)
    expect(verdict.outOfScope.files).toBe(4)
  })
})

describe('merging the shards (B7)', () => {
  it('counts a statement covered when any shard executed it', () => {
    const first = report(
      fileCoverage('src/a.ts', [
        [1, 0],
        [2, 4],
      ])
    )
    const second = report(
      fileCoverage('src/a.ts', [
        [1, 2],
        [2, 0],
      ])
    )

    const outcome = mergeReports([first, second])

    expect(outcome.merged).toBe(true)
    const merged = outcome.merged && outcome.report['src/a.ts']
    expect(merged && merged.s).toEqual({ '0': 2, '1': 4 })
  })

  it('keeps a file only one shard saw', () => {
    const outcome = mergeReports([
      report(fileCoverage('src/a.ts', [[1, 1]])),
      report(fileCoverage('src/b.ts', [[2, 1]])),
    ])

    expect(outcome.merged && Object.keys(outcome.report).sort()).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('refuses to merge shards that disagree about a file, rather than guessing (B7)', () => {
    // Same path, different statement maps: the two shards read different
    // sources. Any merge of that is a made-up number.
    const outcome = mergeReports([
      report(fileCoverage('src/a.ts', [[1, 1]])),
      report(
        fileCoverage('src/a.ts', [
          [1, 1],
          [2, 0],
        ])
      ),
    ])

    expect(outcome.merged).toBe(false)
    expect(outcome.merged === false && outcome.reason).toContain('src/a.ts')
  })

  it('refuses shards whose statements sit on different lines, not just a different count (B7)', () => {
    // Same number of statements, different places: two revisions of one file
    // where a line moved. Comparing only the counts would call these the same
    // source and add up counts that belong to different lines.
    const outcome = mergeReports([
      report(
        fileCoverage('src/a.ts', [
          [1, 1],
          [2, 1],
        ])
      ),
      report(
        fileCoverage('src/a.ts', [
          [1, 0],
          [9, 0],
        ])
      ),
    ])

    expect(outcome.merged).toBe(false)
    expect(outcome.merged === false && outcome.reason).toContain('src/a.ts')
  })

  it('fails when no shard produced a report at all (B7)', () => {
    const outcome = mergeReports([])

    expect(outcome.merged).toBe(false)
    expect(outcome.merged === false && outcome.reason).toMatch(/no coverage/i)
  })
})

describe('recognising a coverage report (B7)', () => {
  // The gate has to be able to say "that file is not a coverage report" instead
  // of grading whatever parsed. An empty object is a legitimate report: a run
  // over files that hold no statements produces one.
  it('accepts a report, including an empty one', () => {
    expect(isCoverageReport(report(fileCoverage('src/a.ts', [[1, 1]])))).toBe(true)
    expect(isCoverageReport({})).toBe(true)
  })

  it('rejects what is not an object of file entries', () => {
    expect(isCoverageReport('{}')).toBe(false)
    expect(isCoverageReport(null)).toBe(false)
    expect(isCoverageReport([])).toBe(false)
    expect(isCoverageReport(7)).toBe(false)
  })

  it('rejects a file entry without the two fields the grading reads', () => {
    expect(isCoverageReport({ 'src/a.ts': { path: 'src/a.ts', s: {} } })).toBe(false)
    expect(isCoverageReport({ 'src/a.ts': { path: 'src/a.ts', statementMap: {} } })).toBe(false)
    expect(isCoverageReport({ 'src/a.ts': null })).toBe(false)
    expect(isCoverageReport({ 'src/a.ts': undefined })).toBe(false)
    expect(isCoverageReport({ 'src/a.ts': 'coverage' })).toBe(false)
    expect(isCoverageReport({ 'src/a.ts': { statementMap: [], s: {} } })).toBe(false)
  })
})

describe('what the report says (B2, B7)', () => {
  it('states what it judged and what it left out of scope', () => {
    const verdict = grade({
      added: { 'src/a.ts': [1, 2], 'README.md': [1] },
      coverage: report(
        fileCoverage('src/a.ts', [
          [1, 1],
          [2, 0],
        ])
      ),
    })

    const text = formatVerdict(verdict).join('\n')

    expect(text).toMatch(/judged/i)
    expect(text).toMatch(/out of scope/i)
  })

  it('prints an uncovered line as file and line, so it can be opened (B2)', () => {
    const verdict = grade({
      added: { 'src/a.ts': [11] },
      coverage: report(fileCoverage('src/a.ts', [[11, 0]])),
    })

    expect(formatVerdict(verdict).join('\n')).toContain('src/a.ts:11')
  })

  it('names an out-of-scope source file in the report (B7)', () => {
    const verdict = grade({ added: { 'src/new.ts': [1] }, coverage: {} })

    expect(formatVerdict(verdict).join('\n')).toContain('src/new.ts')
  })

  it('stays quiet about sections that have nothing in them', () => {
    const verdict = grade({
      added: { 'src/a.ts': [1] },
      coverage: report(fileCoverage('src/a.ts', [[1, 1]])),
    })

    // A clean run is the scope statement and nothing else. Counting the lines
    // says that more sharply than hunting for absent headings by regex.
    const lines = formatVerdict(verdict)

    expect(lines.every((line) => line.endsWith('.'))).toBe(true)
    expect(lines.some((line) => line.startsWith('  - '))).toBe(false)
  })

  it('is shaped as blank-separated blocks, each a heading over its own items', () => {
    const verdict = grade({
      added: { 'src/a.ts': [1, 2], 'src/new.ts': [1] },
      coverage: report(
        fileCoverage('src/a.ts', [
          [1, 1],
          [2, 0],
        ])
      ),
    })

    const [scopeBlock, ...sections] = formatVerdict(verdict).join('\n').split('\n\n')

    // The opening block is the scope statement and nothing else — asserting on
    // it rather than skipping it is what makes a section that runs into the
    // opening, for want of a blank line, visible.
    for (const line of scopeBlock.split('\n')) expect(line).toMatch(/\.$/)

    expect(sections.length).toBeGreaterThan(0)
    for (const block of sections) {
      const [heading, ...items] = block.split('\n')
      expect(heading).toMatch(/:$/)
      expect(items.length).toBeGreaterThan(0)
      for (const item of items) expect(item).toMatch(/^ {2}- /)
    }
  })
})

describe('properties of the grading (B1, B2, B3)', () => {
  const linesArb = fc.uniqueArray(fc.integer({ min: 1, max: 200 }), { minLength: 1, maxLength: 12 })

  it('places every added line of an in-scope file in exactly one bucket', () => {
    fc.assert(
      fc.property(
        linesArb,
        fc.array(fc.tuple(fc.integer({ min: 1, max: 200 }), fc.integer({ min: 0, max: 3 })), {
          maxLength: 24,
        }),
        (added, statements) => {
          const coverage = report(fileCoverage('src/a.ts', statements))
          const verdict = grade({ added: { 'src/a.ts': added }, coverage })

          // Unguarded conservation law: it holds whichever bucket each line
          // took, so no `if` in this test can hide a branch that drops one.
          const accounted = verdict.uncovered.length + verdict.covered + verdict.notExecutable
          expect(accounted).toBe(added.length)
          expect(verdict.judged.lines).toBe(added.length)
        }
      )
    )
  })

  it('is unmoved by coverage of lines the change did not touch (B1)', () => {
    fc.assert(
      fc.property(
        linesArb,
        fc.array(fc.tuple(fc.integer({ min: 1, max: 200 }), fc.integer({ min: 0, max: 3 })), {
          maxLength: 24,
        }),
        fc.array(fc.tuple(fc.integer({ min: 201, max: 400 }), fc.integer({ min: 0, max: 3 })), {
          maxLength: 24,
        }),
        (added, touchedStatements, untouchedStatements) => {
          const withoutNoise = grade({
            added: { 'src/a.ts': added },
            coverage: report(fileCoverage('src/a.ts', touchedStatements)),
          })
          const withNoise = grade({
            added: { 'src/a.ts': added },
            coverage: report(
              fileCoverage('src/a.ts', [...touchedStatements, ...untouchedStatements])
            ),
          })

          // The added lines are all below 201 and the noise all above 200, so
          // nothing the second report adds is a line this change touched.
          expect(withNoise).toEqual(withoutNoise)
        }
      )
    )
  })

  it('reads back exactly the lines a diff added, whatever the hunks are', () => {
    const hunkArb = fc
      .array(fc.tuple(fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 6 })), {
        minLength: 1,
        maxLength: 5,
      })
      .map((raw) => {
        // Hunks in a diff are ascending and do not overlap. That is a property
        // of the input format, decided here before the first run, not a
        // restriction added afterwards to dodge a counterexample.
        let cursor = 1
        return raw.map(([gap, added]) => {
          const from = cursor + gap
          cursor = from + added
          return { from, added }
        })
      })

    fc.assert(
      fc.property(hunkArb, (hunks) => {
        const expected = hunks.flatMap((hunk) =>
          Array.from({ length: hunk.added }, (_unused, offset) => hunk.from + offset)
        )

        expect(parseAddedLines(diffOf([{ path: 'src/a.ts', hunks }]))).toEqual({
          'src/a.ts': expected,
        })
      })
    )
  })

  it('counts a statement covered in the merge exactly when some shard ran it (B7)', () => {
    const shardArb = fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 3, maxLength: 3 })

    fc.assert(
      fc.property(shardArb, shardArb, (first, second) => {
        const shardOf = (counts: number[]) =>
          report(
            fileCoverage(
              'src/a.ts',
              counts.map((count, index): [number, number] => [index + 1, count])
            )
          )

        const forward = mergeReports([shardOf(first), shardOf(second)])
        const backward = mergeReports([shardOf(second), shardOf(first)])

        // Order cannot matter, or which runner finished first would decide
        // whether a line counts as covered.
        expect(forward).toEqual(backward)

        // The guarantee that makes sharding sound at all: a line one shard
        // executed is covered, even though the other shard never touched it.
        // Asserted for every statement, unguarded, so no branch escapes.
        const merged = forward.merged && forward.report['src/a.ts']
        for (let index = 0; index < 3; index += 1) {
          const ranSomewhere = first[index] > 0 || second[index] > 0
          expect(merged && merged.s[String(index)] > 0).toBe(ranSomewhere)
        }
      })
    )
  })
})
