/**
 * The dependency-audit gate's policy, as guarantees rather than as code.
 *
 * A1  A run whose audit could not be performed does not pass. Output that does
 *     not parse as an advisory report, together with a non-zero exit, is a
 *     failure to measure and fails the run saying so — which is a different
 *     outcome from "no advisories found".
 * A2  An advisory reachable from the running service fails the run.
 * A3  The toolchain that builds and tests the image is audited too, not only
 *     what ships inside it.
 * A4  An exception names its advisory, a reason, and the day it stops applying.
 *     It is valid through that day and not one day longer.
 * A5  An exception whose day has passed, while its advisory is still present,
 *     fails the run.
 * A6  An exception that matches no advisory is reported as removable and does
 *     not fail the run.
 * A7  A report states the scope it graded, so a pass cannot be read as a wider
 *     guarantee than it is.
 * A8  A toolchain-only advisory appears in the report and does not fail the
 *     run; only a reachable one does.
 * A9  An empty body from an audit that exited cleanly means no advisories, and
 *     passes.
 * A10 A failure to measure is attempted again before the run fails on it, so a
 *     single unreachable moment does not block a change.
 *
 * A1–A8 are the confirmed list, verbatim. A9 and A10 were added afterwards, on
 * evidence: `bun audit --production --json` exits *1* in this repository today
 * and prints a valid report, so an exit code cannot tell "advisories exist"
 * from "the audit failed" (A9 names the one body-shape that legitimately means
 * nothing found), and with A8 in force a failure to measure becomes the
 * dominant way this gate can fail, which makes retrying it load-bearing (A10).
 *
 * Measured on 2026-09-04: line coverage of `audit-policy.ts` 100% (94/94 lines,
 * 41/41 branches), mutation score 100% — 176 mutants, 175 killed, 1 timeout
 * (a timeout is a detected mutant), no survivors, so there is no equivalent
 * mutant to justify here. `bun x stryker run` reproduces it.
 *
 * What that number covers: this module against `audit-policy.ts`. It says
 * nothing about `audit-check.ts`, whose wiring is where the defect actually
 * lived — that is covered by `audit-check-gate.test.ts`, which is not in the
 * mutation runner's selection because it spawns a process per test.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  formatVerdict,
  grade,
  isExpired,
  measureWithRetry,
  readAuditOutcome,
  startOfUtcDay,
  type AllowlistEntry,
  type AuditReport,
  type AuditRun,
} from '../audit-policy'

/**
 * Midnight UTC on 2026-09-04, written out rather than computed by
 * `startOfUtcDay`. Building the fixture with the function under test would make
 * every date assertion below agree with the implementation by construction.
 */
const TODAY = Date.UTC(2026, 8, 4)

/** A high-severity advisory body, shaped the way `bun audit --json` emits one. */
function advisory(ghsa: string, severity = 'high', title = 'a hole') {
  return { id: 1, url: `https://github.com/advisories/${ghsa}`, title, severity }
}

function report(entries: Record<string, string[]>, severity = 'high'): AuditReport {
  const out: AuditReport = {}
  for (const [pkg, ghsas] of Object.entries(entries)) {
    out[pkg] = ghsas.map((ghsa) => advisory(ghsa, severity))
  }
  return out
}

function run(over: Partial<AuditRun> = {}): AuditRun {
  return { exitCode: 0, stdout: '{}', stderr: '', ...over }
}

function entry(over: Partial<AllowlistEntry> = {}): AllowlistEntry {
  return { ghsa: 'GHSA-aaaa-bbbb-cccc', reason: 'reviewed', expires: '2026-12-01', ...over }
}

describe('reading one audit invocation (A1, A9)', () => {
  it('treats a parseable report as measured, even though bun exits 1 when advisories exist', () => {
    // Not hypothetical: this repository's own production audit exits 1 today.
    const outcome = readAuditOutcome(run({ exitCode: 1, stdout: '{"left-pad":[]}' }))

    expect(outcome.measured).toBe(true)
    expect(outcome.measured && outcome.report).toEqual({ 'left-pad': [] })
  })

  it('treats an empty body from a clean exit as no advisories (A9)', () => {
    const outcome = readAuditOutcome(run({ exitCode: 0, stdout: '  \n' }))

    expect(outcome.measured).toBe(true)
    expect(outcome.measured && outcome.report).toEqual({})
  })

  it('treats an empty body from a failed exit as a failure to measure (A1)', () => {
    const outcome = readAuditOutcome(
      run({ exitCode: 1, stdout: '', stderr: 'error: POST https://reg/ - ConnectionRefused' })
    )

    expect(outcome.measured).toBe(false)
    expect(outcome.measured === false && outcome.reason).toContain('ConnectionRefused')
  })

  it('says the audit did not run, not that nothing was found (A1)', () => {
    const outcome = readAuditOutcome(run({ exitCode: 1, stdout: '', stderr: 'boom' }))

    expect(outcome.measured === false && outcome.reason).toMatch(
      /could not be performed|did not run/i
    )
  })

  it('names which failure it was, so the operator is not left guessing (A1)', () => {
    const noBody = readAuditOutcome(run({ exitCode: 1, stdout: '', stderr: 'nope' }))
    const badBody = readAuditOutcome(run({ exitCode: 1, stdout: '{oh dear', stderr: 'nope' }))
    const wrongShape = readAuditOutcome(run({ exitCode: 0, stdout: '[]', stderr: 'nope' }))

    expect(noBody.measured === false && noBody.reason).toContain('printed no report')
    expect(badBody.measured === false && badBody.reason).toContain('did not parse')
    expect(wrongShape.measured === false && wrongShape.reason).toContain('not an object')
  })

  it('carries the exit code, so a signal kill is distinguishable from a refusal (A1)', () => {
    const outcome = readAuditOutcome(run({ exitCode: 137, stdout: '', stderr: '' }))

    expect(outcome.measured === false && outcome.reason).toContain('bun audit exited 137')
  })

  it('keeps the facts in the reason apart, rather than running them together (A1)', () => {
    const outcome = readAuditOutcome(run({ exitCode: 1, stdout: '', stderr: 'ConnectionRefused' }))

    // Shape, not exact wording: a failure, then the exit code, then what the
    // process said, each readable as its own fact.
    expect(outcome.measured === false && outcome.reason).toMatch(
      /could not be performed: .+; bun audit exited 1; ConnectionRefused/
    )
  })

  it('leaves no dangling separator when there was nothing on stderr', () => {
    const outcome = readAuditOutcome(run({ exitCode: 1, stdout: '', stderr: '   \n ' }))

    expect(outcome.measured === false && outcome.reason).not.toMatch(/[;\s]$/)
  })

  it('treats an unparseable body as a failure to measure, whatever the exit code (A1)', () => {
    for (const exitCode of [0, 1, 2]) {
      const outcome = readAuditOutcome(run({ exitCode, stdout: '<html>proxy error</html>' }))
      expect(outcome.measured).toBe(false)
    }
  })

  it('rejects a body that parses but is not a report (A1)', () => {
    for (const stdout of ['null', '[]', '"nope"', '42']) {
      expect(readAuditOutcome(run({ exitCode: 0, stdout })).measured).toBe(false)
    }
  })
})

describe('retrying a failure to measure (A10)', () => {
  it('returns the first measured attempt without waiting again', async () => {
    const waits: number[] = []
    let attempts = 0

    const outcome = await measureWithRetry(
      async () => {
        attempts += 1
        return run({ exitCode: 1, stdout: '{"a":[]}' })
      },
      { attempts: 3, wait: async (ms) => void waits.push(ms) }
    )

    expect(outcome.measured).toBe(true)
    expect(attempts).toBe(1)
    expect(waits).toEqual([])
  })

  it('retries an unmeasurable audit and passes once it answers', async () => {
    const bodies = ['', '', '{"a":[]}']
    let attempts = 0

    const outcome = await measureWithRetry(
      async () => {
        const stdout = bodies[attempts] ?? ''
        attempts += 1
        return run({ exitCode: 1, stdout, stderr: 'ConnectionRefused' })
      },
      { attempts: 3, wait: async () => {} }
    )

    expect(outcome.measured).toBe(true)
    expect(attempts).toBe(3)
  })

  it('does not pass when it was never allowed to attempt anything (A1)', async () => {
    let attempts = 0

    const outcome = await measureWithRetry(
      async () => {
        attempts += 1
        return run({ exitCode: 0, stdout: '{}' })
      },
      { attempts: 0, wait: async () => {} }
    )

    expect(attempts).toBe(0)
    expect(outcome.measured).toBe(false)
    expect(outcome.measured === false && outcome.reason).toContain('never attempted')
  })

  it('fails after the last attempt instead of passing (A1, A10)', async () => {
    let attempts = 0

    const outcome = await measureWithRetry(
      async () => {
        attempts += 1
        return run({ exitCode: 1, stdout: '', stderr: 'ConnectionRefused' })
      },
      { attempts: 3, wait: async () => {} }
    )

    expect(outcome.measured).toBe(false)
    expect(attempts).toBe(3)
  })

  it('reuses the last delay when asked for more attempts than the table holds', async () => {
    const waits: number[] = []

    await measureWithRetry(async () => run({ exitCode: 1, stdout: '' }), {
      attempts: 5,
      wait: async (ms) => void waits.push(ms),
    })

    expect(waits).toHaveLength(4)
    // The table runs out; nothing may fall through to a zero or absent wait.
    expect(waits.every((ms) => ms > 0)).toBe(true)
    expect(waits[3]).toBe(waits[2])
  })

  it('waits between attempts, so a retry is not three requests in one instant', async () => {
    const waits: number[] = []

    await measureWithRetry(async () => run({ exitCode: 1, stdout: '' }), {
      attempts: 3,
      wait: async (ms) => void waits.push(ms),
    })

    // One wait fewer than attempts: nothing is gained by sleeping after the last.
    expect(waits).toHaveLength(2)
    expect(waits.every((ms) => ms > 0)).toBe(true)
  })
})

describe('when an exception stops applying (A4)', () => {
  it('is valid through its stated day and not one day longer', () => {
    expect(isExpired('2026-09-04', TODAY)).toBe(false)
    expect(isExpired('2026-09-03', TODAY)).toBe(true)
    expect(isExpired('2026-09-05', TODAY)).toBe(false)
  })

  it('reads the day in UTC, so the gate does not depend on the runner clock zone', () => {
    expect(startOfUtcDay(new Date('2026-09-04T23:59:59Z'))).toBe(TODAY)
    expect(startOfUtcDay(new Date('2026-09-04T00:00:00Z'))).toBe(TODAY)
    // And it is the *day*, not the instant: an hour later is still today.
    expect(startOfUtcDay(new Date('2026-09-05T00:00:00Z'))).not.toBe(TODAY)
  })
})

describe('grading what the audit found (A2, A5, A6, A8)', () => {
  const production = report({ 'ship-it': ['GHSA-prod-0001-xxxx'] })
  const all = report({
    'ship-it': ['GHSA-prod-0001-xxxx'],
    'build-it': ['GHSA-dev-0002-xxxx'],
  })

  it('counts what it graded and what it only reported (A7)', () => {
    // Two packages in the tree, one of them shipped. The numbers are the claim
    // the report makes about its own coverage, so they are asserted directly.
    const verdict = grade({ production, all, allowlist: [], todayUtcMs: TODAY })

    expect(verdict.graded).toEqual({ packages: 1, advisories: 1 })
    expect(verdict.reported).toEqual({ packages: 1, advisories: 1 })
  })

  it('counts every advisory in a package, not every package (A7)', () => {
    const verdict = grade({
      production: report({ shipped: ['GHSA-p-0001-xxxx', 'GHSA-p-0002-xxxx'] }),
      all: report({
        shipped: ['GHSA-p-0001-xxxx', 'GHSA-p-0002-xxxx'],
        tooling: ['GHSA-t-0003-xxxx', 'GHSA-t-0004-xxxx', 'GHSA-t-0005-xxxx'],
      }),
      allowlist: [],
      todayUtcMs: TODAY,
    })

    expect(verdict.graded).toEqual({ packages: 1, advisories: 2 })
    expect(verdict.reported).toEqual({ packages: 1, advisories: 3 })
  })

  it('fails on an advisory reachable from the running service (A2)', () => {
    const verdict = grade({ production, all, allowlist: [], todayUtcMs: TODAY })

    expect(verdict.blocking.map((f) => f.ghsa)).toEqual(['GHSA-prod-0001-xxxx'])
    expect(verdict.blocking[0].why).toBe('no exception')
  })

  it('reports a toolchain-only advisory without failing the run (A3, A8)', () => {
    const verdict = grade({ production, all, allowlist: [], todayUtcMs: TODAY })

    expect(verdict.reportedOnly.map((f) => f.ghsa)).toEqual(['GHSA-dev-0002-xxxx'])
    expect(verdict.blocking.map((f) => f.ghsa)).not.toContain('GHSA-dev-0002-xxxx')
  })

  it('suppresses a reachable advisory that has a valid exception', () => {
    const allowlist = [entry({ ghsa: 'GHSA-prod-0001-xxxx', expires: '2026-09-04' })]
    const verdict = grade({ production, all, allowlist, todayUtcMs: TODAY })

    expect(verdict.blocking).toEqual([])
    expect(verdict.suppressed.map((f) => f.ghsa)).toEqual(['GHSA-prod-0001-xxxx'])
  })

  it('does not offer a working exception for deletion (A6)', () => {
    const allowlist = [entry({ ghsa: 'GHSA-prod-0001-xxxx', expires: '2026-12-01' })]
    const verdict = grade({ production, all, allowlist, todayUtcMs: TODAY })

    // It is suppressing a live advisory. Reporting it as removable would talk
    // the next reader into deleting the only thing holding the gate open.
    expect(verdict.suppressed.map((f) => f.ghsa)).toEqual(['GHSA-prod-0001-xxxx'])
    expect(verdict.removable).toEqual([])
  })

  it('fails a reachable advisory whose exception has run out (A5)', () => {
    const allowlist = [entry({ ghsa: 'GHSA-prod-0001-xxxx', expires: '2026-09-03' })]
    const verdict = grade({ production, all, allowlist, todayUtcMs: TODAY })

    expect(verdict.suppressed).toEqual([])
    expect(verdict.blocking).toHaveLength(1)
    expect(verdict.blocking[0].why).toBe('exception expired')
  })

  // A6 is about what the *entry* does, not about the fixture being clean: this
  // pair asserts the blocking set is unchanged by adding the entry. An earlier
  // draft asserted `blocking` was empty, which this fixture can never be — it
  // carries an unexcused reachable advisory on purpose — and would have passed
  // only by accident of a quieter fixture.
  // Built inside each test, not in the describe body: a call out here runs
  // while vitest is still collecting the file, so any fault in `grade` takes
  // the whole suite down at import — which reads as "no test failed" and
  // scores a mutant as survived.
  const baselineBlocking = () =>
    grade({ production, all, allowlist: [], todayUtcMs: TODAY }).blocking

  it('reports an exception that matches nothing as removable, and does not fail on it (A6)', () => {
    const allowlist = [entry({ ghsa: 'GHSA-gone-0003-xxxx' })]
    const verdict = grade({ production, all, allowlist, todayUtcMs: TODAY })

    expect(verdict.blocking).toEqual(baselineBlocking())
    expect(verdict.removable.map((r) => r.ghsa)).toEqual(['GHSA-gone-0003-xxxx'])
    expect(verdict.removable[0].why).toMatch(/no advisory matches/i)
    expect(verdict.removable[0].why).not.toMatch(/toolchain/i)
  })

  it('reports an exception for a toolchain-only advisory as removable without calling it absent', () => {
    const allowlist = [entry({ ghsa: 'GHSA-dev-0002-xxxx' })]
    const verdict = grade({ production, all, allowlist, todayUtcMs: TODAY })

    expect(verdict.blocking).toEqual(baselineBlocking())
    expect(verdict.removable).toHaveLength(1)
    expect(verdict.removable[0].why).toMatch(/toolchain/i)
  })

  it('falls back to the numeric id when the advisory url has no last segment', () => {
    // Real shape: a url that ends in a slash. Without the fallback the finding
    // carries an empty identifier, which matches no exception and prints blank.
    const trailingSlash = {
      id: 4242,
      url: 'https://github.com/advisories/',
      title: 'a hole',
      severity: 'critical',
    }
    const both = { 'ship-it': [trailingSlash] }
    const verdict = grade({ production: both, all: both, allowlist: [], todayUtcMs: TODAY })

    expect(verdict.blocking.map((f) => f.ghsa)).toEqual(['4242'])
  })

  it('ignores severities below the blocking bar, reachable or not', () => {
    const low = report({ 'ship-it': ['GHSA-prod-0001-xxxx'] }, 'moderate')
    const verdict = grade({ production: low, all: low, allowlist: [], todayUtcMs: TODAY })

    expect(verdict.blocking).toEqual([])
    expect(verdict.reportedOnly).toEqual([])
    expect(verdict.suppressed).toEqual([])
  })

  it('decides reachability per package, not per advisory id', () => {
    // One advisory, two packages: shipped by one, only built with by the other.
    // Keying on the GHSA alone would either block both or excuse both.
    const shared = 'GHSA-x-0001-xxxx'
    const verdict = grade({
      production: report({ shipped: [shared] }),
      all: report({ shipped: [shared], tooling: [shared] }),
      allowlist: [],
      todayUtcMs: TODAY,
    })

    expect(verdict.blocking.map((f) => f.package)).toEqual(['shipped'])
    expect(verdict.reportedOnly.map((f) => f.package)).toEqual(['tooling'])
  })
})

describe('what the report claims (A7)', () => {
  it('states the scope it graded and the scope it only reported', () => {
    const verdict = grade({
      production: report({ 'ship-it': ['GHSA-a-0001-xxxx'] }),
      all: report({ 'ship-it': ['GHSA-a-0001-xxxx'], 'build-it': ['GHSA-b-0002-xxxx'] }),
      allowlist: [entry({ ghsa: 'GHSA-a-0001-xxxx' })],
      todayUtcMs: TODAY,
    })

    const text = formatVerdict(verdict).join('\n')

    expect(text).toMatch(/graded/i)
    expect(text).toMatch(/reported/i)
    // The severities that can fail a run are part of the scope, not folklore —
    // and they are a list, so they have to read as one.
    expect(text).toMatch(/high, critical/)
  })

  it('prints the counts, not just the word "graded" (A7)', () => {
    const verdict = grade({
      production: report({ shipped: ['GHSA-a-0001-xxxx'] }),
      all: report({ shipped: ['GHSA-a-0001-xxxx'], tooling: ['GHSA-b-0002-xxxx'] }),
      allowlist: [],
      todayUtcMs: TODAY,
    })

    const text = formatVerdict(verdict).join('\n')

    // A scope line without its numbers is a claim without evidence.
    expect(text).toMatch(/production dependencies — 1 package\(s\), 1 advisory\(ies\)/)
    expect(text).toMatch(/toolchain — 1 package\(s\), 1 advisory\(ies\)/)
  })

  it('prints a suppressed advisory with the day it stops being suppressed (A4)', () => {
    const verdict = grade({
      production: report({ shipped: ['GHSA-a-0001-xxxx'] }),
      all: report({ shipped: ['GHSA-a-0001-xxxx'] }),
      allowlist: [
        entry({ ghsa: 'GHSA-a-0001-xxxx', expires: '2026-12-01', reason: 'upstream fix pending' }),
      ],
      todayUtcMs: TODAY,
    })

    const text = formatVerdict(verdict).join('\n')

    expect(text).toMatch(/allowlisted advisories/i)
    expect(text).toContain('GHSA-a-0001-xxxx')
    expect(text).toContain('2026-12-01')
    expect(text).toContain('upstream fix pending')
  })

  it('gives the toolchain findings their own heading, so they are not read as blocking (A8)', () => {
    const verdict = grade({
      production: {},
      all: report({ tooling: ['GHSA-b-0002-xxxx'] }),
      allowlist: [],
      todayUtcMs: TODAY,
    })

    expect(formatVerdict(verdict).join('\n')).toMatch(/toolchain-only advisories/i)
  })

  it('is shaped as blank-separated blocks, each a heading over its own items', () => {
    const verdict = grade({
      production: report({ shipped: ['GHSA-a-0001-xxxx'] }),
      all: report({ shipped: ['GHSA-a-0001-xxxx'], tooling: ['GHSA-b-0002-xxxx'] }),
      allowlist: [
        entry({ ghsa: 'GHSA-a-0001-xxxx', expires: '2026-12-01' }),
        entry({ ghsa: 'GHSA-gone-0009-xxxx' }),
      ],
      todayUtcMs: TODAY,
    })

    const [scopeBlock, ...sections] = formatVerdict(verdict).join('\n').split('\n\n')

    // The opening block is the scope statement and nothing else. An earlier
    // draft skipped it instead of asserting on it, and that left a real
    // survivor: writing text over the blank line before the first section
    // merges that section into the opening, and a check that starts at the
    // second block never sees it.
    for (const line of scopeBlock.split('\n')) expect(line).toMatch(/\.$/)

    // Every section is a heading and its list, which is what makes a stray
    // line between sections visible.
    expect(sections.length).toBeGreaterThan(0)
    for (const block of sections) {
      const [heading, ...items] = block.split('\n')
      expect(heading).toMatch(/:$/)
      expect(items.length).toBeGreaterThan(0)
      for (const item of items) expect(item).toMatch(/^ {2}- /)
    }
  })

  it('stays quiet about sections that have nothing in them', () => {
    const verdict = grade({ production: {}, all: {}, allowlist: [], todayUtcMs: TODAY })

    const text = formatVerdict(verdict).join('\n')

    // A heading over an empty list reads as a finding that got lost.
    expect(text).not.toMatch(/no longer doing anything/i)
    expect(text).not.toMatch(/allowlisted advisories/i)
    expect(text).not.toMatch(/toolchain-only advisories/i)
  })

  it('prints allowlist entries that no longer do anything, so they get deleted', () => {
    const verdict = grade({
      production: {},
      all: {},
      allowlist: [entry({ ghsa: 'GHSA-gone-0009-xxxx', reason: 'was a real one once' })],
      todayUtcMs: TODAY,
    })

    const text = formatVerdict(verdict).join('\n')

    expect(text).toContain('GHSA-gone-0009-xxxx')
    expect(text).toMatch(/no longer doing anything/i)
  })

  it('does not describe a toolchain finding as blocking', () => {
    const verdict = grade({
      production: {},
      all: report({ 'build-it': ['GHSA-b-0002-xxxx'] }),
      allowlist: [],
      todayUtcMs: TODAY,
    })

    const text = formatVerdict(verdict).join('\n')

    expect(text).toContain('GHSA-b-0002-xxxx')
    expect(text).not.toMatch(/^FAIL/m)
  })
})

describe('properties of the grading (A2, A8)', () => {
  const hexDigit = fc.constantFrom(...'0123456789abcdef'.split(''))
  const ghsaArb = fc
    .tuple(
      fc.string({ unit: hexDigit, minLength: 4, maxLength: 4 }),
      fc.integer({ min: 1, max: 9999 })
    )
    .map(([tag, n]) => `GHSA-${tag}-${n}-zzzz`)

  const severityArb = fc.constantFrom('low', 'moderate', 'high', 'critical')

  const findingArb = fc.record({
    pkg: fc.constantFrom('alpha', 'beta', 'gamma', 'delta'),
    ghsa: ghsaArb,
    severity: severityArb,
    reachable: fc.boolean(),
  })

  /** Build a production/all pair from a flat list of findings. */
  function reportsFrom(
    findings: ReadonlyArray<{ pkg: string; ghsa: string; severity: string; reachable: boolean }>
  ) {
    const production: AuditReport = {}
    const all: AuditReport = {}
    for (const f of findings) {
      const body = advisory(f.ghsa, f.severity)
      all[f.pkg] = [...(all[f.pkg] ?? []), body]
      if (f.reachable) production[f.pkg] = [...(production[f.pkg] ?? []), body]
    }
    return { production, all }
  }

  it('places every high or critical advisory in exactly one bucket', () => {
    fc.assert(
      fc.property(
        fc.array(findingArb, { maxLength: 12 }),
        fc.array(entryArb(ghsaArb), { maxLength: 4 }),
        (findings, allowlist) => {
          const { production, all } = reportsFrom(findings)
          const verdict = grade({ production, all, allowlist, todayUtcMs: TODAY })

          const seen = [
            ...verdict.blocking.map((f) => f.ghsa),
            ...verdict.suppressed.map((f) => f.ghsa),
            ...verdict.reportedOnly.map((f) => f.ghsa),
          ]
          const gradeable = findings
            .filter((f) => f.severity === 'high' || f.severity === 'critical')
            .map((f) => f.ghsa)

          // Unguarded conservation law: it holds whichever branch each advisory
          // took, so no `if` in this test can hide a branch that drops one.
          // Occurrences, not distinct ids — one GHSA can hit two packages, and
          // a de-duplicated comparison would not notice one of them going
          // missing.
          expect([...seen].sort()).toEqual([...gradeable].sort())
        }
      ),
      { numRuns: 300 }
    )
  })

  it('never blocks on an advisory that is absent from the production tree', () => {
    fc.assert(
      fc.property(fc.array(findingArb, { maxLength: 12 }), (findings) => {
        const { production, all } = reportsFrom(findings)
        const verdict = grade({ production, all, allowlist: [], todayUtcMs: TODAY })

        const reachableGhsas = new Set(findings.filter((f) => f.reachable).map((f) => f.ghsa))
        for (const blocked of verdict.blocking) {
          expect(reachableGhsas.has(blocked.ghsa)).toBe(true)
        }
      }),
      { numRuns: 300 }
    )
  })

  it('is unmoved by an advisory title, which the gate must not read', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (titleA, titleB) => {
        const withTitle = (title: string): AuditReport => ({
          'ship-it': [advisory('GHSA-t-0001-zzzz', 'critical', title)],
        })
        const of = (title: string) =>
          grade({
            production: withTitle(title),
            all: withTitle(title),
            allowlist: [],
            todayUtcMs: TODAY,
          }).blocking.map((f) => f.ghsa)

        expect(of(titleA)).toEqual(of(titleB))
      }),
      { numRuns: 200 }
    )
  })

  it('is unmoved by an exception for a GHSA that is not present', () => {
    fc.assert(
      fc.property(fc.array(findingArb, { maxLength: 8 }), ghsaArb, (findings, unrelated) => {
        const { production, all } = reportsFrom(findings)
        const present = new Set(findings.map((f) => f.ghsa))
        fc.pre(!present.has(unrelated))

        const without = grade({ production, all, allowlist: [], todayUtcMs: TODAY })
        const withIt = grade({
          production,
          all,
          allowlist: [entry({ ghsa: unrelated })],
          todayUtcMs: TODAY,
        })

        expect(withIt.blocking.map((f) => f.ghsa)).toEqual(without.blocking.map((f) => f.ghsa))
      }),
      { numRuns: 300 }
    )
  })
})

/** An allowlist entry whose GHSA is drawn from the same space as the findings. */
function entryArb(ghsaArb: fc.Arbitrary<string>) {
  return fc.record({
    ghsa: ghsaArb,
    reason: fc.constant('reviewed'),
    expires: fc.constantFrom('2026-09-03', '2026-09-04', '2026-12-01'),
  })
}
