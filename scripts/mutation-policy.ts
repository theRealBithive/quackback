/**
 * The mutation gate's policy: which of the files a change touched get mutated,
 * and which mutants of them count against it.
 *
 * Pure by design — no git, no file reads, no runner, no exit. The gate around it
 * (`mutation-check.ts`) does that, and the guarantees are numbered in
 * `__tests__/mutation-policy.test.ts`.
 *
 * Two decisions here are worth reading before changing anything.
 *
 * **A file is mutated because someone declared it, not because it has a suite
 * next to it.** The declaration lives in `mutation-manifest.json` and pairs a
 * file with the suites that pin it. Selecting by convention instead — mutate
 * whatever has a co-located `__tests__/<name>.test.ts` — was measured and
 * rejected: 27% of this repository's source files have one, and on the file that
 * probe was run against, that suite reached only the module's pure half. A
 * convention would have graded the other half against a suite nobody claimed
 * covered it.
 *
 * **An unexecuted mutant fails like a survivor.** Stryker calls it `NoCoverage`
 * and leaves it out of the score it prints largest, so a module can read 92%
 * while a third of it was never touched. Grading over every mutant is guarantee
 * B9, and it is the whole reason this module computes its own score rather than
 * reading Stryker's.
 */

/** One file and the suites declared to pin it. */
export type ManifestEntry = {
  file: string
  suites: string[]
}

/**
 * One mutation excused as behaviourally identical to the original.
 *
 * Addressed by the *text* of the line rather than by its number, so that the
 * record retires when the line is edited and follows it when the line merely
 * moves. A record keyed by `file:line` would drift onto whatever an insertion
 * pushed into its place, and go on excusing code nobody looked at.
 */
export type EquivalenceRecord = {
  file: string
  mutator: string
  /** The source line as it read when the record was written, without indentation. */
  line: string
  replacement: string
  /** Why no test can tell the mutant from the original. Read by people, not by code. */
  why: string
}

export type Manifest = {
  graded: ManifestEntry[]
  equivalents: EquivalenceRecord[]
}

/** One mutant, in the shape Stryker's json report holds. */
export type Mutant = {
  mutatorName: string
  status: string
  replacement: string
  location: { start: { line: number } }
}

export type MutatedFile = {
  source: string
  mutants: Mutant[]
}

export type MutationReport = {
  files: Record<string, MutatedFile>
  /** What the dry run discovered. Empty means the selection pointed at nothing. */
  testFiles?: Record<string, { tests: unknown[] }>
}

export type Selection = {
  /** Touched and declared. These are what the run mutates. */
  graded: ManifestEntry[]
  /** Touched source the manifest does not declare. Named, never silently skipped. */
  notGraded: string[]
  /** Every declared suite, once, in a stable order. */
  suites: string[]
}

export type Finding = {
  file: string
  line: number
  mutator: string
  replacement: string
  status: 'Survived' | 'NoCoverage'
}

export type Counts = {
  total: number
  killed: number
  timeout: number
  survived: number
  noCoverage: number
  compileError: number
  /** Everything else Stryker can report — a runtime error, an ignored mutant. */
  other: number
  excused: number
}

export type Verdict = {
  /** Survivors and unexecuted mutants that no record excuses. These fail the gate. */
  findings: Finding[]
  /** Records that excused nothing in a file this run actually mutated. */
  stale: EquivalenceRecord[]
  counts: Counts
  /** Killed over gradable, in [0, 1]. Over every mutant, never over the covered ones. */
  score: number
  files: number
  notGraded: string[]
}

export type Measurement =
  { measured: true; report: MutationReport } | { measured: false; reason: string }

/**
 * A parsed `mutation-manifest.json`, checked field by field.
 *
 * It throws rather than returning a reason, because a manifest is checked in and
 * a broken one is a mistake in the repository, not a condition of the run: the
 * gate catches it and reports that it could not measure, and
 * `__tests__/mutation-scope.test.ts` catches it on every run either way. The
 * checks are here rather than in the gate so they hold for both callers.
 */
export function readManifest(value: unknown): Manifest {
  if (!isPlainObject(value) || !Array.isArray(value.graded) || !Array.isArray(value.equivalents)) {
    throw new Error('the manifest needs a `graded` array and an `equivalents` array')
  }

  const graded = value.graded.map((entry) => {
    if (!isPlainObject(entry) || typeof entry.file !== 'string' || !Array.isArray(entry.suites)) {
      throw new Error(
        `a manifest entry needs a \`file\` and a \`suites\` array: ${JSON.stringify(entry)}`
      )
    }
    if (entry.suites.length === 0 || !entry.suites.every((suite) => typeof suite === 'string')) {
      throw new Error(`the entry for ${entry.file} needs at least one suite, named as a string`)
    }
    return { file: entry.file, suites: entry.suites as string[] }
  })

  const equivalents = value.equivalents.map((record): EquivalenceRecord => {
    const incomplete = new Error(
      `an equivalence record needs file, mutator, line, replacement and why, all of them strings: ${JSON.stringify(record)}`
    )
    if (!isPlainObject(record)) throw incomplete

    const { file, mutator, line, replacement, why } = record
    if (
      typeof file !== 'string' ||
      typeof mutator !== 'string' ||
      typeof line !== 'string' ||
      typeof replacement !== 'string' ||
      typeof why !== 'string'
    ) {
      throw incomplete
    }
    if (why.trim() === '') {
      throw new Error(`the record for ${file} needs a reason, not an empty one`)
    }

    return { file, mutator, line, replacement, why }
  })

  return { graded, equivalents }
}

/**
 * The files a change reaches: the ones it edited, plus the ones whose declared
 * suite it edited.
 *
 * The second half matters because a manifest entry is a claim that those suites
 * pin that file. An edit that only weakens a suite leaves the source untouched,
 * so nothing would be selected and the weakened claim would first be measured
 * on somebody else's change. Editing the suite re-measures the claim.
 */
export function filesTouchedBy(input: { changed: string[]; manifest: Manifest }): string[] {
  const reached = new Set(input.changed)
  for (const entry of input.manifest.graded) {
    if (entry.suites.some((suite) => reached.has(suite))) reached.add(entry.file)
  }
  return [...reached]
}

/**
 * The files this change puts under mutation, and the ones it does not.
 *
 * Touched *and* declared is the intersection guarantee B4 asks for: a manifest
 * entry the change did not touch is not mutated, and a touched file with no
 * entry is reported by name instead. Naming it is what stops the selection
 * shrinking quietly — the same device the coverage gate uses for a file that
 * falls out of its include.
 */
export function selectForChange(input: { changed: string[]; manifest: Manifest }): Selection {
  const declared = new Map(input.manifest.graded.map((entry) => [entry.file, entry]))
  const graded: ManifestEntry[] = []
  const notGraded: string[] = []

  for (const file of [...input.changed].sort()) {
    const entry = declared.get(file)
    if (entry) {
      graded.push(entry)
      continue
    }
    if (looksLikeSource(file)) notGraded.push(file)
  }

  const suites = new Set<string>()
  for (const entry of graded) {
    for (const suite of entry.suites) suites.add(suite)
  }

  return { graded, notGraded, suites: [...suites].sort() }
}

/**
 * Is this a file whose behaviour a mutant could describe?
 *
 * A suite is excluded because it is not the code under test: changing a test
 * and being told it is not mutation-graded would be noise on every run. A `.d.ts`
 * holds no behaviour at all.
 */
function looksLikeSource(file: string): boolean {
  if (file.endsWith('.d.ts')) return false
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) return false
  if (file.includes('/__tests__/')) return false
  return file.endsWith('.ts') || file.endsWith('.tsx')
}

/**
 * A parsed json report, or the reason it cannot be graded.
 *
 * Two shapes have to be refused rather than graded, and both would otherwise
 * read as findings instead of as a run that measured nothing. A report naming no
 * file means the mutation never happened. A report whose dry run executed no
 * test is what a renamed or misspelled suite in the manifest produces: vitest
 * matches nothing, every mutant survives, and the gate would report a
 * catastrophic failure of a suite that never ran.
 */
export function readMeasurement(value: unknown): Measurement {
  if (!isPlainObject(value) || !isPlainObject(value.files)) {
    return { measured: false, reason: 'the mutation report is not a report at all' }
  }

  for (const [file, entry] of Object.entries(value.files)) {
    if (
      !isPlainObject(entry) ||
      typeof entry.source !== 'string' ||
      !Array.isArray(entry.mutants)
    ) {
      return {
        measured: false,
        reason: `the mutation report's entry for ${file} has no source and mutants`,
      }
    }
  }

  if (Object.keys(value.files).length === 0) {
    return { measured: false, reason: 'the mutation report names no file, so nothing was mutated' }
  }

  const report = value as MutationReport
  if (dryRunTests(report) === 0) {
    return {
      measured: false,
      reason: 'the run executed no test at all, so every mutant would survive by default',
    }
  }

  return { measured: true, report }
}

/** How many tests the dry run discovered across the selected suites. */
export function dryRunTests(report: MutationReport): number {
  let tests = 0
  for (const file of Object.values(report.testFiles ?? {})) tests += file.tests.length
  return tests
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The mutants that count against the change, and the score over all of them.
 *
 * A timeout is a detected mutant: the tests noticed it, by hanging. A
 * `CompileError` is Stryker failing to build a mutant that was never valid
 * TypeScript, which is not a gap in a suite — it is counted and printed, and
 * left out of the score, the way Stryker itself leaves it out.
 */
export function gradeReport(input: {
  report: MutationReport
  equivalents: EquivalenceRecord[]
  notGraded: string[]
}): Verdict {
  const findings: Finding[] = []
  const counts: Counts = {
    total: 0,
    killed: 0,
    timeout: 0,
    survived: 0,
    noCoverage: 0,
    compileError: 0,
    other: 0,
    excused: 0,
  }
  const usedRecords = new Set<EquivalenceRecord>()

  for (const file of Object.keys(input.report.files).sort()) {
    const mutated = input.report.files[file]
    const sourceLines = mutated.source.split('\n')

    for (const mutant of mutated.mutants) {
      counts.total += 1

      if (mutant.status === 'Killed') {
        counts.killed += 1
        continue
      }
      if (mutant.status === 'Timeout') {
        counts.timeout += 1
        continue
      }
      if (mutant.status === 'CompileError') {
        counts.compileError += 1
        continue
      }
      if (mutant.status !== 'Survived' && mutant.status !== 'NoCoverage') {
        counts.other += 1
        continue
      }

      if (mutant.status === 'Survived') counts.survived += 1
      else counts.noCoverage += 1

      const record = excusing({ file, mutant, sourceLines, records: input.equivalents })
      if (record) {
        counts.excused += 1
        usedRecords.add(record)
        continue
      }

      findings.push({
        file,
        line: mutant.location.start.line,
        mutator: mutant.mutatorName,
        replacement: mutant.replacement,
        status: mutant.status,
      })
    }
  }

  const gradable = counts.killed + counts.timeout + counts.survived + counts.noCoverage

  return {
    findings,
    stale: input.equivalents.filter(
      (record) => record.file in input.report.files && !usedRecords.has(record)
    ),
    counts,
    score: gradable === 0 ? 1 : (counts.killed + counts.timeout) / gradable,
    files: Object.keys(input.report.files).length,
    notGraded: input.notGraded,
  }
}

/**
 * The record that excuses this mutant, if one does.
 *
 * All four of file, mutator, replacement and the line's own text have to agree.
 * Dropping any one of them lets a record silence a mutation nobody argued
 * about — a different operator on the same line, or the same operator after the
 * line was rewritten.
 */
function excusing(input: {
  file: string
  mutant: Mutant
  sourceLines: string[]
  records: EquivalenceRecord[]
}): EquivalenceRecord | undefined {
  const actual = input.sourceLines[input.mutant.location.start.line - 1]
  if (actual === undefined) return undefined

  return input.records.find(
    (record) =>
      record.file === input.file &&
      record.mutator === input.mutant.mutatorName &&
      record.replacement === input.mutant.replacement &&
      record.line.trim() === actual.trim()
  )
}

/** A verdict as lines to print, leading with what was graded and what was not. */
export function formatVerdict(verdict: Verdict): string[] {
  const { counts } = verdict
  const lines: string[] = [
    `Mutated (the files this change touched that the manifest declares): ${verdict.files} file(s), ${counts.total} mutant(s) — ${counts.killed} killed, ${counts.timeout} killed by timeout, ${counts.survived} survived, ${counts.noCoverage} never executed.`,
    `Score over every mutant: ${(verdict.score * 100).toFixed(2)}% (${counts.excused} excused as equivalent, ${counts.compileError} did not compile, ${counts.other} neither).`,
    `Not mutation-graded (touched, but no entry in the manifest): ${verdict.notGraded.length} file(s).`,
  ]

  if (verdict.findings.length) {
    lines.push('', 'Mutants the tests did not catch:')
    for (const finding of verdict.findings) {
      const how = finding.status === 'NoCoverage' ? 'never executed' : 'survived'
      lines.push(
        `  - ${finding.file}:${finding.line} ${finding.mutator} -> ${finding.replacement} (${how})`
      )
    }
  }

  if (verdict.notGraded.length) {
    lines.push('', 'Not mutation-graded, although they look like source:')
    for (const file of verdict.notGraded) lines.push(`  - ${file}`)
  }

  if (verdict.stale.length) {
    lines.push('', 'Equivalence records that excused nothing — the line they name has changed:')
    for (const record of verdict.stale) {
      lines.push(
        `  - ${record.file}: ${record.mutator} -> ${record.replacement} on \`${record.line}\``
      )
    }
  }

  return lines
}
