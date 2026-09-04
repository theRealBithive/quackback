#!/usr/bin/env bun
/**
 * CI gate: the mutants of the code this change touched have to die.
 *
 * The grading lives in `mutation-policy.ts` and is covered by
 * `__tests__/mutation-policy.test.ts`. This file is only the process around it:
 * it asks git what changed, generates the run's Stryker and vitest
 * configuration from `scripts/mutation-manifest.json`, spawns the runner under
 * a wall-clock budget, prints, and picks an exit code. Its own guarantees — a
 * gate that cannot measure fails, and the comparison is against the merge
 * base — are covered by `__tests__/mutation-gate.test.ts`.
 *
 * Both configurations are generated rather than checked in, because the
 * manifest is the single source for the pairing of a file with the suites that
 * pin it. A checked-in `mutate` list and a checked-in vitest `include` would be
 * two more places that have to agree with it, and nothing would notice when
 * they stopped.
 *
 * It works on the current directory, not on the directory it is installed in,
 * so it can be pointed at any checkout.
 *
 * Usage: bun scripts/mutation-check.ts
 *
 * Env:
 *   DIFF_BASE                the branch this change will merge into (default origin/main)
 *   MUTATION_BUDGET_SECONDS  wall clock for the whole run (default 900)
 *   MUTATION_ALL             grade every entry in the manifest, ignoring the diff
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseAddedLines } from './diff-coverage-policy'
import {
  filesTouchedBy,
  formatVerdict,
  gradeReport,
  readManifest,
  readMeasurement,
  selectForChange,
  strykerConfigFor,
  type Manifest,
} from './mutation-policy'

const repoRoot = process.cwd()
const diffBase = process.env.DIFF_BASE ?? 'origin/main'
const budgetSeconds = Number(process.env.MUTATION_BUDGET_SECONDS ?? '900')
const gradeEverything = (process.env.MUTATION_ALL ?? '') !== ''

/** Where the generated configuration and the run's report go. Gitignored. */
const runDir = path.join(repoRoot, '.mutation-tmp')
const vitestConfig = path.join(runDir, 'run.vitest.config.ts')
const strykerConfig = path.join(runDir, 'run.stryker.json')
const reportFile = path.join(runDir, 'report.json')

/** Fail loudly. A gate that graded nothing must never look like a pass. */
function couldNotMeasure(reason: string, remedy: string): never {
  console.error(`\nFAIL: the mutation gate graded nothing.`)
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
 * tip reports every line the base branch changed since the fork as a line this
 * change touched, and would then mutate files this change never opened.
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

function manifestOrExit(): Manifest {
  const file = path.join(repoRoot, 'scripts', 'mutation-manifest.json')
  try {
    return readManifest(JSON.parse(readFileSync(file, 'utf8')))
  } catch (error) {
    couldNotMeasure(
      `scripts/mutation-manifest.json could not be read: ${(error as Error).message}`,
      `It declares which files are mutation-graded and which suites pin them.`
    )
  }
}

/**
 * The files this change touched, in the same sense the coverage gate uses:
 * a file with lines on the new side of the diff.
 *
 * A change to a *suite* counts as touching the file it pins. Without that, an
 * edit that only weakens a test would never be mutation-graded — the source is
 * untouched, so nothing would be selected, and the suite that no longer pins
 * the file would be measured for the first time on somebody else's change.
 */
function touchedFiles(manifest: Manifest): string[] {
  if (gradeEverything) return manifest.graded.map((entry) => entry.file)

  const mergeBase = mergeBaseOrExit()
  console.log(`Compared against ${mergeBase} (the merge base with ${diffBase}).`)

  const added = Object.keys(parseAddedLines(git('diff', '-U0', mergeBase, 'HEAD')))
  return filesTouchedBy({ changed: added, manifest })
}

/**
 * The runner's configuration for this run.
 *
 * The vitest config inherits the repository's — the path aliases in particular,
 * without which nothing under `apps/web` resolves — and overrides two things.
 * `include` becomes the manifest's selection, so the dry run loads only the
 * suites that pin the files under mutation instead of all 1400-odd test files.
 * `globalSetup` is emptied, because the test-database gate has nothing to say
 * about a mutation run and every mutant would otherwise pay for a database
 * probe. The override is a spread rather than `mergeConfig`, which concatenates
 * arrays and would leave the repository's `include` in place — that mistake
 * runs the whole suite per mutant and looks like a hang.
 */
function writeRunConfig(input: { files: string[]; suites: string[] }) {
  rmSync(runDir, { recursive: true, force: true })
  mkdirSync(runDir, { recursive: true })

  writeFileSync(
    vitestConfig,
    `// Generated by scripts/mutation-check.ts. Do not edit; do not check in.
import { defineConfig } from 'vitest/config'
import base from '../vitest.config.ts'

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ${JSON.stringify(input.suites)},
    globalSetup: [],
  },
})
`
  )

  writeFileSync(
    strykerConfig,
    JSON.stringify(
      strykerConfigFor({
        mutate: input.files,
        vitestConfigFile: path.relative(repoRoot, vitestConfig),
        reportFile: path.relative(repoRoot, reportFile),
        tempDirName: path.relative(repoRoot, path.join(runDir, 'stryker')),
      }),
      null,
      2
    )
  )
}

const manifest = manifestOrExit()
const selection = selectForChange({ changed: touchedFiles(manifest), manifest })

if (selection.notGraded.length) {
  console.log(`\nNot mutation-graded (touched, but no entry in the manifest):`)
  for (const file of selection.notGraded) console.log(`  - ${file}`)
}

if (selection.graded.length === 0) {
  console.log(`\nPASS: this change touched no file the manifest declares.`)
  process.exit(0)
}

console.log(
  `\nMutating ${selection.graded.length} file(s) against ${selection.suites.length} suite(s), within ${budgetSeconds}s:`
)
for (const entry of selection.graded) {
  console.log(`  - ${entry.file} <- ${entry.suites.join(', ')}`)
}

writeRunConfig({ files: selection.graded.map((entry) => entry.file), suites: selection.suites })

const run = spawnSync('bun', ['x', 'stryker', 'run', path.relative(repoRoot, strykerConfig)], {
  cwd: repoRoot,
  stdio: 'inherit',
  timeout: budgetSeconds * 1000,
})

// Checked before the report is read: a killed run leaves a partial report or
// none, and "no report" would name the wrong cause.
if (run.error && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
  couldNotMeasure(
    `the run did not finish within MUTATION_BUDGET_SECONDS=${budgetSeconds}.`,
    `Raise the budget in the workflow, or narrow the manifest — but not silently: the number is in the diff either way.`
  )
}
if (run.error) {
  couldNotMeasure(`the runner could not be started: ${run.error.message}`, `Is stryker installed?`)
}

let parsed: unknown
try {
  parsed = JSON.parse(readFileSync(reportFile, 'utf8'))
} catch (error) {
  couldNotMeasure(
    `the run left no readable report at ${path.relative(repoRoot, reportFile)}: ${(error as Error).message}`,
    `Stryker exited with ${run.status ?? 'no status'}; its output is above.`
  )
}

const measurement = readMeasurement(parsed)
if (!measurement.measured) {
  couldNotMeasure(
    measurement.reason,
    `Check that every suite the manifest names still exists and still holds tests.`
  )
}

const verdict = gradeReport({
  report: measurement.report,
  equivalents: manifest.equivalents,
  notGraded: selection.notGraded,
})

console.log('')
for (const line of formatVerdict(verdict)) console.log(line)

if (verdict.findings.length) {
  console.error(
    `\nFAIL: ${verdict.findings.length} mutant(s) of the code this change touched were not caught.`
  )
  console.error(`  Write the test that catches each one, or record it as equivalent in`)
  console.error(`  scripts/mutation-manifest.json with the reason no test could tell the`)
  console.error(`  difference. An entry without that reason is an allowlist.`)
  process.exit(1)
}

if (verdict.stale.length) {
  console.error(`\nFAIL: ${verdict.stale.length} equivalence record(s) no longer match any mutant.`)
  console.error(`  The lines they were written for have changed, so the argument they carry`)
  console.error(`  is about code that is gone. Delete them, or rewrite them for the new line.`)
  process.exit(1)
}

console.log(`\nPASS: every mutant of the code this change touched was caught.`)
