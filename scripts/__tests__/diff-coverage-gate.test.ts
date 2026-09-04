/**
 * The diff-coverage gate as a process, which is where the guarantees the policy
 * cannot hold on its own live.
 *
 * B7 A gate that could not measure fails rather than passes — no diff base,
 *    missing provider, budget exceeded.
 * B8 The comparison is against the merge base of the change, so a branch cannot
 *    pass by comparing against itself.
 *
 * B8 needs a repository whose base branch has moved on after the fork point,
 * so each test builds a throwaway one. The failure it exists for is quiet:
 * comparing against the tip of the base branch instead of the merge base
 * reports lines *someone else deleted* on the base branch as lines this change
 * added, and then demands tests for them.
 *
 * The passing path is deliberately thin here — one run that measures and
 * passes. What it grades is the policy's business, and the policy is covered
 * line by line and mutant by mutant in `diff-coverage-policy.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const gate = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'diff-coverage-check.ts'
)

type GateResult = { exitCode: number; stdout: string; stderr: string }

/**
 * Run the gate the way CI runs it: a real process, in a real repository.
 *
 * vitest runs under node, so the gate is spawned rather than imported — it is
 * a bun script, and `Bun` does not exist in this process.
 */
function runGate(cwd: string, env: Record<string, string>): Promise<GateResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', [gate], { cwd, env: { ...process.env, ...env } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }))
  })
}

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

/**
 * A repository where `main` moved on after `feature` forked from it.
 *
 * `main` deletes a line that `feature` still has. A two-dot diff against the
 * tip of `main` reports that surviving line as an addition of this change; a
 * diff against the merge base does not.
 */
function repoWhoseBaseMovedOn(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'diff-coverage-'))

  git(root, 'init', '--initial-branch=main')
  git(root, 'config', 'user.email', 'test@example.com')
  git(root, 'config', 'user.name', 'Test')

  writeFileSync(path.join(root, 'kept.ts'), 'one\ntwo\nthree\n')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'base')

  git(root, 'checkout', '-b', 'feature')
  writeFileSync(path.join(root, 'mine.ts'), 'mine\n')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'the change under test')

  git(root, 'checkout', 'main')
  writeFileSync(path.join(root, 'kept.ts'), 'one\nthree\n')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'someone else deletes a line')

  git(root, 'checkout', 'feature')

  return root
}

/** A coverage report over the repository's files, with nothing executed. */
function writeCoverage(root: string, files: Record<string, number[]>) {
  const report: Record<string, unknown> = {}
  for (const [file, lines] of Object.entries(files)) {
    const statementMap: Record<string, unknown> = {}
    const counts: Record<string, number> = {}
    lines.forEach((line, index) => {
      statementMap[String(index)] = { start: { line }, end: { line } }
      counts[String(index)] = 0
    })
    report[path.join(root, file)] = { path: path.join(root, file), statementMap, s: counts }
  }

  mkdirSync(path.join(root, 'coverage', 'shard-1'), { recursive: true })
  writeFileSync(
    path.join(root, 'coverage', 'shard-1', 'coverage-final.json'),
    JSON.stringify(report)
  )
}

describe('the diff-coverage gate as a process (B7, B8)', () => {
  it('judges only what this change added, not what the base branch deleted (B8)', async () => {
    const root = repoWhoseBaseMovedOn()
    try {
      // Both files have an uncovered statement on every line, so whichever the
      // gate decides to judge, it will name.
      writeCoverage(root, { 'mine.ts': [1], 'kept.ts': [1, 2] })

      const result = await runGate(root, { DIFF_BASE: 'main' })

      expect(result.stdout).toContain('mine.ts:1')
      expect(result.stdout).not.toContain('kept.ts')
      expect(result.exitCode).not.toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('says which commit it compared against, so a pass can be checked (B8)', async () => {
    const root = repoWhoseBaseMovedOn()
    try {
      writeCoverage(root, { 'mine.ts': [1] })
      const mergeBase = execFileSync('git', ['merge-base', 'main', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim()

      const result = await runGate(root, { DIFF_BASE: 'main' })

      expect(result.stdout).toContain(mergeBase.slice(0, 12))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails when there is no diff base to compare against (B7)', async () => {
    const root = repoWhoseBaseMovedOn()
    try {
      writeCoverage(root, { 'mine.ts': [1] })

      const result = await runGate(root, { DIFF_BASE: 'no-such-branch' })

      expect(result.exitCode).not.toBe(0)
      expect(result.stdout).not.toContain('PASS')
      expect(result.stderr).toMatch(/no-such-branch/)
      expect(result.stderr).toMatch(/graded nothing|could not/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails when no shard left a coverage report behind (B7)', async () => {
    const root = repoWhoseBaseMovedOn()
    try {
      const result = await runGate(root, { DIFF_BASE: 'main' })

      expect(result.exitCode).not.toBe(0)
      expect(result.stdout).not.toContain('PASS')
      // Specific on purpose: a looser /coverage/i matches the gate's own name
      // in an unrelated error and would pass without the gate saying anything.
      expect(result.stderr).toMatch(/no coverage report/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails on a coverage file that parsed but is not a report (B7)', async () => {
    const root = repoWhoseBaseMovedOn()
    try {
      mkdirSync(path.join(root, 'coverage'), { recursive: true })
      writeFileSync(path.join(root, 'coverage', 'coverage-final.json'), '{"src/a.ts":{"s":{}}}')

      const result = await runGate(root, { DIFF_BASE: 'main' })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('coverage-final.json')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails on a coverage file that does not parse at all (B7)', async () => {
    const root = repoWhoseBaseMovedOn()
    try {
      mkdirSync(path.join(root, 'coverage'), { recursive: true })
      // How a report looks when the run that wrote it was killed halfway.
      writeFileSync(path.join(root, 'coverage', 'coverage-final.json'), '{"src/a.ts":{"s":')

      const result = await runGate(root, { DIFF_BASE: 'main' })

      expect(result.exitCode).not.toBe(0)
      expect(result.stdout).not.toContain('PASS')
      expect(result.stderr).toMatch(/did not parse/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reads every shard, and one shard executing a line is enough (B7)', async () => {
    const root = repoWhoseBaseMovedOn()
    try {
      const shard = (statements: Record<string, unknown>, counts: Record<string, number>) =>
        JSON.stringify({
          [path.join(root, 'mine.ts')]: {
            path: path.join(root, 'mine.ts'),
            statementMap: statements,
            s: counts,
          },
        })
      mkdirSync(path.join(root, 'coverage', 'one'), { recursive: true })
      mkdirSync(path.join(root, 'coverage', 'two'), { recursive: true })
      // Two shards of the same commit whose statement ids do not line up: the
      // second reports a statement the first does not, which shifts every id
      // after it. Only the second shard executed line 1. This is the shape the
      // v8 provider actually produces, and reading it per id rather than per
      // line failed the whole gate on a real run.
      writeFileSync(
        path.join(root, 'coverage', 'one', 'coverage-final.json'),
        shard({ '0': { start: { line: 1 } } }, { '0': 0 })
      )
      writeFileSync(
        path.join(root, 'coverage', 'two', 'coverage-final.json'),
        shard({ '0': { start: { line: 9 } }, '1': { start: { line: 1 } } }, { '0': 2, '1': 4 })
      )

      const result = await runGate(root, { DIFF_BASE: 'main' })

      expect(result.stdout).toContain('2 report(s)')
      expect(result.stdout).toContain('PASS')
      expect(result.exitCode).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails when every report that arrived was empty (B7)', async () => {
    const root = repoWhoseBaseMovedOn()
    try {
      // A report can be valid JSON of the right shape and still say nothing.
      // It would leave every touched file out of scope, and out of scope
      // passes — so an empty merge has to fail instead.
      mkdirSync(path.join(root, 'coverage'), { recursive: true })
      writeFileSync(path.join(root, 'coverage', 'coverage-final.json'), '{}')

      const result = await runGate(root, { DIFF_BASE: 'main' })

      expect(result.exitCode).not.toBe(0)
      expect(result.stdout).not.toContain('PASS')
      expect(result.stderr).toMatch(/nothing was measured/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails on a report written in a different checkout (B7)', async () => {
    const root = repoWhoseBaseMovedOn()
    try {
      // What downloading CI's artifacts onto another machine produces: the
      // paths are absolute and belong to the runner's checkout. Grading them
      // against this checkout's diff matches nothing, leaves every touched
      // file out of scope, and prints a pass.
      mkdirSync(path.join(root, 'coverage'), { recursive: true })
      writeFileSync(
        path.join(root, 'coverage', 'coverage-final.json'),
        JSON.stringify({
          '/home/runner/work/quackback/quackback/mine.ts': {
            path: '/home/runner/work/quackback/quackback/mine.ts',
            statementMap: { '0': { start: { line: 1 } } },
            s: { '0': 1 },
          },
        })
      )

      const result = await runGate(root, { DIFF_BASE: 'main' })

      expect(result.exitCode).not.toBe(0)
      expect(result.stdout).not.toContain('PASS')
      expect(result.stderr).toMatch(/not in this checkout/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('passes a change whose added lines all ran', async () => {
    const root = repoWhoseBaseMovedOn()
    try {
      const covered = {
        [path.join(root, 'mine.ts')]: {
          path: path.join(root, 'mine.ts'),
          statementMap: { '0': { start: { line: 1 } } },
          s: { '0': 3 },
        },
      }
      mkdirSync(path.join(root, 'coverage'), { recursive: true })
      writeFileSync(path.join(root, 'coverage', 'coverage-final.json'), JSON.stringify(covered))

      const result = await runGate(root, { DIFF_BASE: 'main' })

      expect(result.stdout).toContain('PASS')
      expect(result.exitCode).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
