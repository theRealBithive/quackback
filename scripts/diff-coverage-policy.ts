/**
 * The diff-coverage gate's policy: which of the lines a change added are
 * executable, and which of those no test executed.
 *
 * Pure by design — no git, no file reads, no exit. The gate around it
 * (`diff-coverage-check.ts`) does that, and the guarantees are numbered in
 * `__tests__/diff-coverage-policy.test.ts`.
 *
 * Line coverage here means what it means everywhere else: a line counts as
 * executable when a statement *starts* on it, and as covered when one of the
 * statements starting on it ran. A line in the middle of a multi-line statement
 * has no statement of its own and is therefore not judged. That is istanbul's
 * rule, and every line-coverage number anyone compares this against uses it —
 * deviating would either invent uncovered lines or, worse, let a nested
 * uncovered statement hide inside an enclosing one that did run.
 */

/** One file's coverage, in the istanbul shape `coverage-final.json` holds. */
export type FileCoverage = {
  path: string
  statementMap: Record<string, { start: { line: number } }>
  s: Record<string, number>
}

/**
 * A whole `coverage-final.json`, keyed by repo-relative path.
 *
 * The reporter writes absolute paths; the gate normalises them before grading,
 * so that a report and a diff can be compared by the same key.
 */
export type CoverageReport = Record<string, FileCoverage>

/** The lines a change added or altered, keyed by repo-relative path. */
export type AddedLines = Record<string, number[]>

export type MergeOutcome =
  { merged: true; report: CoverageReport } | { merged: false; reason: string }

export type UncoveredLine = { file: string; line: number }

export type Verdict = {
  /** Added, executable, and never executed. These fail the gate. */
  uncovered: UncoveredLine[]
  judged: { files: number; lines: number }
  covered: number
  notExecutable: number
  outOfScope: { files: number; named: string[]; unnamed: number }
}

/**
 * The added lines of a `git diff -U0`, read from the new-side hunk ranges.
 *
 * With zero context every line the new side gained is an addition, so the
 * header carries the whole answer and the hunk body does not need reading.
 *
 * A `+++ ` line only counts as a file header when a `--- ` line came directly
 * before it, which is what a unified diff guarantees. Without that, an added
 * source line whose own text begins `++ ` reads as a file header and moves
 * every following hunk onto a file the change never touched. The remaining
 * ambiguity — a removed line beginning `--` directly above an added line
 * beginning `++` — is a diff of a diff, and left alone.
 */
export function parseAddedLines(diff: string): AddedLines {
  const added: AddedLines = {}
  let currentFile = ''
  let afterOldSideHeader = false

  for (const line of diff.split('\n')) {
    const isFileHeader = afterOldSideHeader && line.startsWith('+++ ')
    afterOldSideHeader = line.startsWith('--- ')

    if (isFileHeader) {
      currentFile = newSidePath(line)
      continue
    }

    // The hunk-header pattern is the only thing that decides whether this is a
    // hunk header — an added line carries a `+` in front of its text, so it
    // cannot match a pattern anchored at the start of the line.
    const range = newSideRange(line)
    if (!range || currentFile === '') continue

    const lines = added[currentFile] ?? []
    for (let offset = 0; offset < range.count; offset += 1) lines.push(range.start + offset)
    added[currentFile] = lines
  }

  return added
}

/**
 * The path in a `+++ b/some/file` header.
 *
 * A deleted file's header says `/dev/null`, which needs no special case: its
 * hunk adds no lines, so nothing is ever attributed to it.
 */
function newSidePath(header: string): string {
  const path = header.slice('+++ '.length)
  if (path.startsWith('b/')) return path.slice('b/'.length)
  return path
}

/** `@@ -3,2 +4,5 @@` gives start 4 and count 5. No count means one line. */
function newSideRange(hunk: string): { start: number; count: number } | null {
  const match = /^@@ -\S+ \+(\d+(?:,\d+)?) @@/.exec(hunk)
  if (!match) return null

  const [rawStart, rawCount] = match[1].split(',')
  // A truthiness check rather than a comparison against undefined: this
  // tsconfig types an absent split field as `string`, so the comparison would
  // not typecheck. '0' is truthy, so a hunk that adds nothing still reads 0.
  const count = rawCount ? Number(rawCount) : 1
  if (count === 0) return null

  return { start: Number(rawStart), count }
}

/**
 * One coverage report out of the shards' reports.
 *
 * Every shard runs a subset of the suite, so each one reports zero for the
 * files its tests never loaded. A line is covered when *some* shard ran it,
 * which makes summing the per-statement counts the whole merge.
 */
export function mergeReports(reports: CoverageReport[]): MergeOutcome {
  if (reports.length === 0) {
    return { merged: false, reason: 'no coverage report was collected, so nothing was measured' }
  }

  const merged: CoverageReport = {}

  for (const report of reports) {
    for (const [file, coverage] of Object.entries(report)) {
      const known = merged[file]
      if (!known) {
        merged[file] = {
          path: coverage.path,
          statementMap: coverage.statementMap,
          s: { ...coverage.s },
        }
        continue
      }
      if (statementLayout(known) !== statementLayout(coverage)) {
        return {
          merged: false,
          reason: `${file}: two shards report different statements for it, so they did not read the same source`,
        }
      }
      for (const [id, count] of Object.entries(coverage.s)) known.s[id] += count
    }
  }

  return { merged: true, report: merged }
}

/** Where a file's statements start, as one string: same source, same layout. */
function statementLayout(coverage: FileCoverage): string {
  return Object.entries(coverage.statementMap)
    .map(([id, statement]) => `${id}:${statement.start.line}`)
    .join(',')
}

/** Does this parse as a coverage report, or is it merely valid JSON? */
export function isCoverageReport(value: unknown): value is CoverageReport {
  if (!isPlainObject(value)) return false

  for (const entry of Object.values(value)) {
    if (!isPlainObject(entry)) return false
    if (!isPlainObject(entry.statementMap) || !isPlainObject(entry.s)) return false
  }

  return true
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function grade(input: { added: AddedLines; coverage: CoverageReport }): Verdict {
  const uncovered: UncoveredLine[] = []
  const namedOutOfScope: string[] = []
  let unnamedOutOfScope = 0
  let covered = 0
  let notExecutable = 0
  let judgedFiles = 0
  let judgedLines = 0

  for (const file of Object.keys(input.added).sort()) {
    const coverage = input.coverage[file]
    if (!coverage) {
      // Not in the coverage configuration's include: markdown, a test file, a
      // generated bundle. Source-looking files are named, because an include
      // that quietly stops matching one is how this gate would grade nothing
      // and still pass.
      if (looksLikeSource(file)) namedOutOfScope.push(file)
      else unnamedOutOfScope += 1
      continue
    }

    const lines = input.added[file]
    judgedFiles += 1
    judgedLines += lines.length

    const executions = executionsPerLine(coverage)
    for (const line of [...lines].sort((left, right) => left - right)) {
      const count = executions.get(line)
      if (count === undefined) notExecutable += 1
      else if (count > 0) covered += 1
      else uncovered.push({ file, line })
    }
  }

  return {
    uncovered,
    judged: { files: judgedFiles, lines: judgedLines },
    covered,
    notExecutable,
    outOfScope: {
      files: namedOutOfScope.length + unnamedOutOfScope,
      named: namedOutOfScope,
      unnamed: unnamedOutOfScope,
    },
  }
}

/**
 * The highest execution count among the statements starting on each line.
 *
 * A line absent from this map has no statement of its own — a comment, a blank
 * line, a type, or the tail of a multi-line statement — and is not judged.
 */
function executionsPerLine(coverage: FileCoverage): Map<number, number> {
  const executions = new Map<number, number>()

  for (const [id, statement] of Object.entries(coverage.statementMap)) {
    const line = statement.start.line
    const count = coverage.s[id]
    const best = executions.get(line)
    if (best === undefined || best < count) executions.set(line, count)
  }

  return executions
}

function looksLikeSource(file: string): boolean {
  return file.endsWith('.ts') || file.endsWith('.tsx')
}

/** A verdict as lines to print, leading with what was judged and what was not. */
export function formatVerdict(verdict: Verdict): string[] {
  const lines: string[] = [
    `Judged (the lines this change added or touched): ${verdict.judged.files} file(s), ${verdict.judged.lines} line(s) — ${verdict.covered} executed, ${verdict.uncovered.length} never executed, ${verdict.notExecutable} with nothing to execute.`,
    `Out of scope (not in the coverage configuration): ${verdict.outOfScope.files} file(s).`,
  ]

  if (verdict.uncovered.length) {
    lines.push('', 'Added lines that no test executed:')
    for (const hole of verdict.uncovered) lines.push(`  - ${hole.file}:${hole.line}`)
  }

  if (verdict.outOfScope.named.length) {
    lines.push('', 'Out of scope, although they look like source:')
    for (const file of verdict.outOfScope.named) lines.push(`  - ${file}`)
  }

  return lines
}
