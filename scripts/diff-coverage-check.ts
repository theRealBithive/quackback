#!/usr/bin/env bun
/**
 * CI gate: every line this change added has to have been executed by a test.
 *
 * The grading lives in `diff-coverage-policy.ts` and is covered by
 * `__tests__/diff-coverage-policy.test.ts`. This file is only the process
 * around it: it asks git what changed, reads the shards' coverage reports,
 * prints, and picks an exit code. Its own guarantees — a gate that cannot
 * measure fails, and the comparison is against the merge base — are covered by
 * `__tests__/diff-coverage-gate.test.ts`.
 *
 * It works on the current directory, not on the directory it is installed in,
 * so it can be pointed at any checkout.
 *
 * Usage: bun scripts/diff-coverage-check.ts
 *
 * Env:
 *   DIFF_BASE     the branch this change will merge into (default origin/main)
 *   COVERAGE_DIR  where the shards' reports were collected (default coverage)
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  formatVerdict,
  grade,
  isCoverageReport,
  mergeReports,
  parseAddedLines,
  type CoverageReport,
} from './diff-coverage-policy'

const repoRoot = process.cwd()
const diffBase = process.env.DIFF_BASE ?? 'origin/main'
const coverageDir = path.resolve(repoRoot, process.env.COVERAGE_DIR ?? 'coverage')

/** Fail loudly. A gate that graded nothing must never look like a pass. */
function couldNotMeasure(reason: string, remedy: string): never {
  console.error(`\nFAIL: the diff-coverage gate graded nothing.`)
  console.error(`  ${reason}`)
  console.error(`  ${remedy}`)
  process.exit(1)
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
}

/**
 * The commit this change forked from.
 *
 * The merge base, not the tip of the base branch: a two-dot diff against the
 * tip reports every line the base branch has *deleted* since the fork as a
 * line this change added, and would then demand tests for someone else's
 * deletion.
 */
function mergeBaseOrExit(): string {
  try {
    return git('merge-base', diffBase, 'HEAD').trim()
  } catch (error) {
    couldNotMeasure(
      `it found no merge base between ${diffBase} and HEAD: ${(error as Error).message.trim()}`,
      `Fetch the base branch first — a shallow clone has no common commit to compare against.`
    )
  }
}

/** Every `coverage-final.json` under the collection directory. */
function reportPaths(dir: string): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true, recursive: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name === 'coverage-final.json')
    .map((entry) => path.join(entry.parentPath, entry.name))
}

/** A report with its keys turned into repo-relative paths. */
function readReportOrExit(file: string): CoverageReport {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    couldNotMeasure(
      `${path.relative(repoRoot, file)} did not parse: ${(error as Error).message}`,
      `A truncated report means the run that wrote it did not finish.`
    )
  }
  if (!isCoverageReport(parsed)) {
    couldNotMeasure(
      `${path.relative(repoRoot, file)} parsed but is not a coverage report.`,
      `Expected an object of file entries, each with a statementMap and an s map.`
    )
  }

  const relative: CoverageReport = {}
  for (const [absolute, coverage] of Object.entries(parsed)) {
    const inRepo = path.relative(repoRoot, absolute)
    if (inRepo.startsWith('..')) {
      // The report was written somewhere else — CI artifacts read on a laptop,
      // or a checkout that moved. Every path would then miss the diff's paths,
      // every touched file would land out of scope, and out of scope passes.
      couldNotMeasure(
        `${path.relative(repoRoot, file)} covers ${absolute}, which is not in this checkout.`,
        `The report has to come from a run in ${repoRoot}.`
      )
    }
    relative[inRepo] = coverage
  }
  return relative
}

const mergeBase = mergeBaseOrExit()
const added = parseAddedLines(git('diff', '-U0', mergeBase, 'HEAD'))

const files = reportPaths(coverageDir)
if (files.length === 0) {
  couldNotMeasure(
    `no coverage report was found under ${path.relative(repoRoot, coverageDir)}.`,
    `Every shard has to run with --coverage and upload its coverage-final.json.`
  )
}

const outcome = mergeReports(files.map(readReportOrExit))
if (!outcome.merged) {
  couldNotMeasure(
    outcome.reason,
    `An empty report means the run wrote one before it had executed anything.`
  )
}

const verdict = grade({ added, coverage: outcome.report })

console.log(`Compared against ${mergeBase} (the merge base with ${diffBase}).`)
console.log(
  `Coverage read from ${files.length} report(s) under ${path.relative(repoRoot, coverageDir)}.`
)
for (const line of formatVerdict(verdict)) console.log(line)

if (verdict.uncovered.length) {
  console.error(
    `\nFAIL: ${verdict.uncovered.length} line(s) this change added were never executed by a test.`
  )
  console.error(`  Cover them, or delete them. The gate judges only the lines above.`)
  process.exit(1)
}

console.log('\nPASS: every line this change added was executed by a test.')
