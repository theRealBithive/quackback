/**
 * The dependency-audit gate's policy, separated from the process it runs in.
 *
 * The guarantees are numbered in `__tests__/audit-policy.test.ts`. Nothing in
 * here spawns a process, reads a file or exits — `audit-check.ts` does that and
 * hands the results in, so every branch below is reachable from a test. That
 * split is the whole reason this file exists: the version that did its own
 * spawning had a branch nobody could reach, and it read a failed audit as a
 * clean one for as long as it existed.
 */

/** The severities that can fail a run. Everything else is noise for this gate. */
const BLOCKING_SEVERITIES = new Set(['high', 'critical'])

/** How long to wait before each retry of an audit that could not be performed. */
const RETRY_DELAYS_MS = [2000, 5000]

/** One advisory, shaped the way `bun audit --json` emits it. */
export interface Advisory {
  id: number
  url: string
  title: string
  severity: string
}

/** `bun audit --json` prints one object: package name -> advisories against it. */
export type AuditReport = Record<string, Advisory[]>

/** What one `bun audit` invocation left behind. */
export interface AuditRun {
  exitCode: number
  stdout: string
  stderr: string
}

/** Either the audit produced a report, or it could not be performed. */
export type AuditOutcome =
  { measured: true; report: AuditReport } | { measured: false; reason: string }

export interface AllowlistEntry {
  ghsa: string
  reason: string
  expires: string
}

export interface Finding {
  package: string
  ghsa: string
  severity: string
  title: string
}

export interface BlockingFinding extends Finding {
  why: 'no exception' | 'exception expired'
  expires?: string
}

export interface SuppressedFinding extends Finding {
  expires: string
  reason: string
}

export interface RemovableEntry {
  ghsa: string
  why: string
}

/** How much was looked at, so a verdict can say what it covers. */
export interface Scope {
  packages: number
  advisories: number
}

export interface Verdict {
  blocking: BlockingFinding[]
  suppressed: SuppressedFinding[]
  reportedOnly: Finding[]
  removable: RemovableEntry[]
  graded: Scope
  reported: Scope
}

export interface GradeInput {
  production: AuditReport
  all: AuditReport
  allowlist: AllowlistEntry[]
  todayUtcMs: number
}

export interface RetryOptions {
  attempts: number
  wait: (ms: number) => Promise<void>
}

/** True for an object of advisory lists, false for `null`, arrays and scalars. */
function isReport(value: unknown): value is AuditReport {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The operator-facing reason an audit produced no usable report. */
function failureReason(run: AuditRun, detail: string): string {
  const firstStderrLine = run.stderr.trim().split('\n')[0]
  const parts = [`the audit could not be performed: ${detail}`, `bun audit exited ${run.exitCode}`]
  if (firstStderrLine) parts.push(firstStderrLine)
  return parts.join('; ')
}

/**
 * What one invocation told us.
 *
 * `bun audit` exits 1 both when advisories exist and when it could not reach
 * the registry — in this repository the healthy production audit exits 1 today
 * — so the exit code cannot tell those apart. The body can: a parseable object
 * is a report whatever the exit code, and an empty body is only "nothing found"
 * when the process also exited cleanly.
 */
export function readAuditOutcome(run: AuditRun): AuditOutcome {
  const body = run.stdout.trim()

  if (body === '' && run.exitCode === 0) return { measured: true, report: {} }
  if (body === '') return { measured: false, reason: failureReason(run, 'it printed no report') }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (error) {
    const detail = `its report did not parse: ${(error as Error).message}`
    return { measured: false, reason: failureReason(run, detail) }
  }

  if (!isReport(parsed)) {
    const detail = 'its report was not an object of advisories'
    return { measured: false, reason: failureReason(run, detail) }
  }

  return { measured: true, report: parsed }
}

/** The wait before retry `index`, reusing the last entry once the table runs out. */
function delayBeforeRetry(index: number): number {
  return RETRY_DELAYS_MS[index] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]
}

/**
 * Run the audit until it produces a report, or until the attempts run out.
 *
 * A registry that is unreachable for one moment must not block a change, and
 * one that is unreachable for good must not pass as clean.
 */
export async function measureWithRetry(
  attempt: () => Promise<AuditRun>,
  options: RetryOptions
): Promise<AuditOutcome> {
  let outcome: AuditOutcome = {
    measured: false,
    reason: 'the audit could not be performed: it was never attempted',
  }

  for (let index = 0; index < options.attempts; index += 1) {
    outcome = readAuditOutcome(await attempt())
    if (outcome.measured) return outcome

    // Nothing is gained by waiting after the last attempt. An earlier version
    // also broke out of the loop here, which made the loop's own bound dead
    // code — two mechanisms for one decision, and the bound could be changed
    // without any test noticing.
    const hasAnotherAttempt = index + 1 < options.attempts
    if (hasAnotherAttempt) await options.wait(delayBeforeRetry(index))
  }

  return outcome
}

/** Midnight UTC on the day `now` falls in. */
export function startOfUtcDay(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

/** True once the day named by `expires` has passed. Valid through that day. */
export function isExpired(expires: string, todayUtcMs: number): boolean {
  return Date.parse(expires) < todayUtcMs
}

/**
 * GHSA identifier is the last path segment of the advisory url.
 *
 * A url that ends in a slash has an empty last segment. `pop()` returns that
 * empty string rather than `undefined`, so a `??` fallback never fired for it
 * and the advisory ended up with a blank identifier — which matches no
 * exception and prints as nothing. The numeric id is the fallback.
 */
function ghsaOf(advisory: Advisory): string {
  const lastSegment = advisory.url.split('/').pop()
  if (lastSegment) return lastSegment
  return String(advisory.id)
}

/** Package and advisory together — one GHSA can hit a shipped and a build-only package. */
function reachabilityKey(pkg: string, ghsa: string): string {
  return `${pkg} ${ghsa}`
}

function countScope(report: AuditReport): Scope {
  let advisories = 0
  for (const list of Object.values(report)) advisories += list.length
  return { packages: Object.keys(report).length, advisories }
}

/** Every (package, advisory) pair that is present in the production tree. */
function reachablePairs(production: AuditReport): Set<string> {
  const pairs = new Set<string>()
  for (const [pkg, advisories] of Object.entries(production)) {
    for (const advisory of advisories) pairs.add(reachabilityKey(pkg, ghsaOf(advisory)))
  }
  return pairs
}

/**
 * Sort every high or critical advisory into exactly one bucket.
 *
 * Reachable from the running service and unexcused: blocking. Reachable with a
 * valid exception: suppressed. Present only in the build and test toolchain:
 * reported, never blocking — a compromised toolchain is worth knowing about and
 * is not a reason to stop unrelated work.
 */
export function grade(input: GradeInput): Verdict {
  const reachable = reachablePairs(input.production)
  const exceptionFor = new Map(input.allowlist.map((entry) => [entry.ghsa, entry]))

  const blocking: BlockingFinding[] = []
  const suppressed: SuppressedFinding[] = []
  const reportedOnly: Finding[] = []
  const seenReachable = new Set<string>()
  const seenToolchainOnly = new Set<string>()

  const toolchainPackages = new Set<string>()
  let toolchainAdvisories = 0

  for (const [pkg, advisories] of Object.entries(input.all)) {
    for (const advisory of advisories) {
      const ghsa = ghsaOf(advisory)
      const isReachable = reachable.has(reachabilityKey(pkg, ghsa))

      if (!isReachable) {
        toolchainPackages.add(pkg)
        toolchainAdvisories += 1
      }

      if (!BLOCKING_SEVERITIES.has(advisory.severity)) continue

      const finding: Finding = {
        package: pkg,
        ghsa,
        severity: advisory.severity,
        title: advisory.title,
      }

      if (!isReachable) {
        reportedOnly.push(finding)
        seenToolchainOnly.add(ghsa)
        continue
      }

      seenReachable.add(ghsa)
      const exception = exceptionFor.get(ghsa)
      if (!exception) {
        blocking.push({ ...finding, why: 'no exception' })
        continue
      }
      if (isExpired(exception.expires, input.todayUtcMs)) {
        blocking.push({ ...finding, why: 'exception expired', expires: exception.expires })
        continue
      }
      suppressed.push({ ...finding, expires: exception.expires, reason: exception.reason })
    }
  }

  const removable: RemovableEntry[] = []
  for (const entry of input.allowlist) {
    if (seenReachable.has(entry.ghsa)) continue
    if (seenToolchainOnly.has(entry.ghsa)) {
      removable.push({
        ghsa: entry.ghsa,
        why: 'its advisory is toolchain-only, which never blocks a run',
      })
      continue
    }
    removable.push({ ghsa: entry.ghsa, why: 'no advisory matches it any more' })
  }

  return {
    blocking,
    suppressed,
    reportedOnly,
    removable,
    graded: countScope(input.production),
    reported: { packages: toolchainPackages.size, advisories: toolchainAdvisories },
  }
}

/** A verdict as lines to print, leading with what was graded and what was not. */
export function formatVerdict(verdict: Verdict): string[] {
  const severities = [...BLOCKING_SEVERITIES].join(', ')
  const lines: string[] = [
    `Graded (can fail this run): production dependencies — ${verdict.graded.packages} package(s), ${verdict.graded.advisories} advisory(ies) of any severity.`,
    `Reported only (never fails this run): build and test toolchain — ${verdict.reported.packages} package(s), ${verdict.reported.advisories} advisory(ies) of any severity.`,
    `Severities that fail a run: ${severities}.`,
  ]

  if (verdict.suppressed.length) {
    lines.push('', 'Allowlisted advisories (not blocking):')
    for (const finding of verdict.suppressed) {
      lines.push(
        `  - ${finding.package} ${finding.ghsa} (${finding.severity}) - ${finding.title} [allowed until ${finding.expires}: ${finding.reason}]`
      )
    }
  }

  if (verdict.reportedOnly.length) {
    lines.push('', 'Toolchain-only advisories (reported, not blocking):')
    for (const finding of verdict.reportedOnly) {
      lines.push(`  - ${finding.package} ${finding.ghsa} (${finding.severity}) - ${finding.title}`)
    }
  }

  if (verdict.removable.length) {
    lines.push('', 'Allowlist entries that are no longer doing anything:')
    for (const entry of verdict.removable) {
      lines.push(`  - ${entry.ghsa}: ${entry.why}`)
    }
  }

  return lines
}
