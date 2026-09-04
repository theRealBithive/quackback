#!/usr/bin/env bun
/**
 * CI dependency-audit gate with a reviewed, time-boxed exception list.
 *
 * The grading lives in `audit-policy.ts` and is covered by
 * `__tests__/audit-policy.test.ts`. This file is only the process around it: it
 * spawns `bun audit`, reads the allowlist, prints, and picks an exit code.
 *
 * Two audits run. Production dependencies can fail the run. The whole tree is
 * audited as well so that an advisory which only reaches the build and test
 * toolchain is still reported — reported, not blocking, which is a decision:
 * a compromised toolchain is worth knowing about and is not a reason to stop
 * unrelated work.
 *
 * The one thing this gate must never do is pass because it could not measure.
 * `bun audit` exits 1 both when advisories exist and when it cannot reach the
 * registry, and an earlier version of this file read the second case as "no
 * advisories" and printed PASS.
 *
 * Usage: bun scripts/audit-check.ts
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  formatVerdict,
  grade,
  measureWithRetry,
  startOfUtcDay,
  type AllowlistEntry,
  type AuditReport,
  type AuditRun,
} from './audit-policy'

/**
 * How many times to attempt an audit that could not be performed.
 *
 * Lowered in tests that assert the failure path, so they do not sit through the
 * retry delays. CI leaves it alone.
 */
const AUDIT_ATTEMPTS = Number(process.env.AUDIT_ATTEMPTS ?? 3)

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const allowlistPath = path.join(repoRoot, '.audit-allowlist.json')

function loadAllowlist(): AllowlistEntry[] {
  let parsed: { advisories?: AllowlistEntry[] }
  try {
    parsed = JSON.parse(readFileSync(allowlistPath, 'utf8'))
  } catch (error) {
    console.error(
      `Could not read ${path.relative(repoRoot, allowlistPath)}: ${(error as Error).message}`
    )
    process.exit(2)
  }
  const entries = parsed.advisories ?? []
  for (const entry of entries) {
    if (!entry.ghsa || !entry.reason || !entry.expires) {
      console.error(
        `Invalid allowlist entry (needs ghsa, reason, expires): ${JSON.stringify(entry)}`
      )
      process.exit(2)
    }
    if (Number.isNaN(Date.parse(entry.expires))) {
      console.error(`Invalid expires date for ${entry.ghsa}: ${entry.expires} (use YYYY-MM-DD)`)
      process.exit(2)
    }
  }
  return entries
}

/**
 * One `bun audit` invocation over the given dependency scope.
 *
 * `node:child_process` rather than `Bun.spawn`: it types against `@types/node`,
 * which is already here, so this file can be typechecked without adding a
 * dependency for the sake of one call. It runs the same under bun.
 */
function auditOnce(scopeArgs: string[]): Promise<AuditRun> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', ['audit', ...scopeArgs, '--json'], { cwd: repoRoot })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    // A process killed by a signal reports a null code. There is no report in
    // that case either, so it counts as an audit that could not be performed.
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }))
  })
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Measure one scope, or fail the run: a gate that graded nothing is not a pass. */
async function measureOrExit(label: string, scopeArgs: string[]): Promise<AuditReport> {
  const outcome = await measureWithRetry(() => auditOnce(scopeArgs), {
    attempts: AUDIT_ATTEMPTS,
    wait,
  })
  if (outcome.measured) return outcome.report

  console.error(`\nFAIL: the ${label} audit did not run, so this gate graded nothing.`)
  console.error(`  ${outcome.reason}`)
  console.error(
    `  Attempted ${AUDIT_ATTEMPTS} time(s). Passing here would have reported "not measured" as "no advisories".`
  )
  process.exit(1)
}

const allowlist = loadAllowlist()
const production = await measureOrExit('production dependency', ['--production'])
const all = await measureOrExit('full dependency tree', [])

const verdict = grade({
  production,
  all,
  allowlist,
  todayUtcMs: startOfUtcDay(new Date()),
})

for (const line of formatVerdict(verdict)) console.log(line)

if (verdict.blocking.length) {
  console.error(
    `\nFAIL: ${verdict.blocking.length} production high/critical advisory(ies) not covered by a valid allowlist entry:`
  )
  for (const finding of verdict.blocking) {
    const expiredNote =
      finding.why === 'exception expired'
        ? ` [allowlist entry expired ${finding.expires}, re-review required]`
        : ''
    console.error(
      `  - ${finding.package} ${finding.ghsa} (${finding.severity}) - ${finding.title}${expiredNote}`
    )
  }
  console.error(
    `\nRemediate by upgrading/overriding the dependency, or add a reviewed, dated exception to ${path.relative(
      repoRoot,
      allowlistPath
    )}.`
  )
  process.exit(1)
}

console.log('\nPASS: no un-allowlisted production high/critical advisories.')
