/**
 * The audit gate, as a process.
 *
 * Contract: A1 in `audit-policy.test.ts` — a run whose audit could not be
 * performed does not pass. The policy module is unit-tested; this file exists
 * because the defect it guards against was in the wiring, not in the policy:
 * `bun audit` exits 1 both when advisories exist and when it cannot reach the
 * registry, and the gate read the second case as an empty report and printed
 * `PASS: no un-allowlisted production high/critical advisories.`
 *
 * An unreachable registry is simulated with a port nothing listens on, so this
 * test needs no network and behaves the same on a laptop and in CI.
 *
 * The passing path is deliberately not asserted here. It would make this suite
 * depend on the npm registry being reachable, and it is already covered
 * structurally: CI runs this gate on every change, so a gate that always failed
 * would turn the `check` job red immediately.
 */
import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const gate = path.join(repoRoot, 'scripts/audit-check.ts')

/** Nothing listens on port 1, so a fetch against it fails without waiting. */
const DEAD_REGISTRY = 'http://127.0.0.1:1/'

/** Run the gate as CI runs it — a real process, so the wiring is under test. */
function runGate(env: Record<string, string>): Promise<{
  exitCode: number | null
  stdout: string
  stderr: string
}> {
  // vitest runs under node, so the gate is spawned rather than imported: `Bun`
  // does not exist in this process, and the gate is a bun script.
  return new Promise((resolve, reject) => {
    const child = spawn('bun', [gate], { cwd: repoRoot, env: { ...process.env, ...env } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }))
  })
}

describe('an audit that cannot be performed (A1)', () => {
  it('fails the run and says the audit did not run, instead of reporting no advisories', async () => {
    const result = await runGate({
      BUN_CONFIG_REGISTRY: DEAD_REGISTRY,
      // One attempt: the retry delays are covered by unit tests, and this case
      // is deterministic, so there is nothing to wait for.
      AUDIT_ATTEMPTS: '1',
    })

    expect(result.exitCode).not.toBe(0)
    // The regression, stated positively: the old gate printed exactly this.
    expect(result.stdout).not.toContain('PASS')
    // And it has to say *which* thing went wrong, or the next person reads a
    // non-zero exit as "advisories found" and goes looking for a dependency.
    expect(result.stderr).toContain('did not run')
    expect(result.stderr).toMatch(/graded nothing/i)
  }, 30_000)

  it('names the reason it could not measure, not just that it failed', async () => {
    const result = await runGate({
      BUN_CONFIG_REGISTRY: DEAD_REGISTRY,
      AUDIT_ATTEMPTS: '1',
    })

    expect(result.stderr).toMatch(/bun audit exited/i)
    // bun reports the refused connection on stderr; the gate has to carry it
    // through rather than swallow it, which is how the original lost it.
    expect(result.stderr).toMatch(/connectionrefused|failed to connect|econnrefused/i)
  }, 30_000)
})
