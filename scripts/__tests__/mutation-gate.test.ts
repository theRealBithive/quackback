/**
 * The mutation gate as a process, which is where the guarantees the policy
 * cannot hold on its own live.
 *
 * B4 Mutants are generated only for code this change touched, and the run finishes
 *    within a stated time budget.
 * B7 A gate that could not measure fails rather than passes — no diff base,
 *    missing provider, budget exceeded.
 * B8 The comparison is against the merge base of the change, so a branch cannot
 *    pass by comparing against itself.
 *
 * Most tests here run against a throwaway repository, with the real gate
 * spawned against it as its working directory: the script resolves its own
 * imports from where it lives and its manifest from where it is pointed, so a
 * temporary repository needs nothing but a manifest and some commits.
 *
 * The budget test is the exception and runs against this repository, because
 * exceeding a budget requires a runner that really starts. It writes and then
 * removes `.mutation-tmp/`, which is gitignored.
 *
 * What a finished run grades is the policy's business, and the policy is
 * covered mutant by mutant in `mutation-policy.test.ts`. There is deliberately
 * no test here that runs a mutation to completion: it would cost minutes per
 * run and assert what the policy already asserts.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const gate = path.join(repoRoot, 'scripts', 'mutation-check.ts')

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

const temporaryRepos: string[] = []

afterAll(() => {
  for (const root of temporaryRepos) rmSync(root, { recursive: true, force: true })
  rmSync(path.join(repoRoot, '.mutation-tmp'), { recursive: true, force: true })
})

/**
 * A repository where `main` moved on after `feature` forked from it, holding
 * the manifest given.
 *
 * The base moving on is what separates a merge-base comparison from a
 * two-dot one: `main` here edits a file `feature` never opened, and a diff
 * against the tip of `main` would report that file as touched by this change.
 */
function repoWith(manifest: unknown): string {
  const root = mkdtempSync(path.join(tmpdir(), 'mutation-gate-'))
  temporaryRepos.push(root)

  git(root, 'init', '--initial-branch=main')
  git(root, 'config', 'user.email', 'test@example.com')
  git(root, 'config', 'user.name', 'Test')

  mkdirSync(path.join(root, 'scripts'), { recursive: true })
  mkdirSync(path.join(root, 'src'), { recursive: true })
  if (manifest !== undefined) {
    writeFileSync(
      path.join(root, 'scripts', 'mutation-manifest.json'),
      JSON.stringify(manifest, null, 2)
    )
  }
  writeFileSync(path.join(root, 'src', 'declared.ts'), 'export const one = 1\n')
  writeFileSync(path.join(root, 'src', 'elsewhere.ts'), 'export const two = 2\n')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'base')

  git(root, 'checkout', '-b', 'feature')

  git(root, 'checkout', 'main')
  writeFileSync(path.join(root, 'src', 'elsewhere.ts'), 'export const two = 22\n')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'someone else edits a file this change never opens')

  git(root, 'checkout', 'feature')

  return root
}

const VALID_MANIFEST = {
  graded: [{ file: 'src/declared.ts', suites: ['src/__tests__/declared.test.ts'] }],
  equivalents: [],
}

describe('the mutation gate as a process (B4, B7, B8)', () => {
  it('fails when there is no diff base to compare against (B7)', async () => {
    const root = repoWith(VALID_MANIFEST)
    const result = await runGate(root, { DIFF_BASE: 'origin/does-not-exist' })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/graded nothing/i)
    expect(result.stderr).toMatch(/no merge base/i)
  })

  it('fails when the manifest is not a manifest (B7)', async () => {
    const root = repoWith({ graded: [] })
    const result = await runGate(root, { DIFF_BASE: 'main' })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/mutation-manifest\.json could not be read/i)
  })

  it('fails when an entry declares no suite to pin it with (B7)', async () => {
    // A file mutated against nothing runs no test, so every mutant would
    // survive and the report would read as a catastrophe rather than as a
    // manifest nobody finished writing.
    const root = repoWith({ graded: [{ file: 'src/declared.ts', suites: [] }], equivalents: [] })
    const result = await runGate(root, { DIFF_BASE: 'main' })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/at least one suite/i)
  })

  it('fails when an equivalence record carries no reason (B7)', async () => {
    const root = repoWith({
      ...VALID_MANIFEST,
      equivalents: [
        { file: 'src/declared.ts', mutator: 'M', line: 'x', replacement: 'y', why: '  ' },
      ],
    })
    const result = await runGate(root, { DIFF_BASE: 'main' })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/needs a reason/i)
  })

  it('fails when there is no manifest at all (B7)', async () => {
    const root = repoWith(undefined)
    const result = await runGate(root, { DIFF_BASE: 'main' })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/mutation-manifest\.json could not be read/i)
  })

  it('passes a change that touched no declared file, and names what it did not grade (B4)', async () => {
    const root = repoWith(VALID_MANIFEST)
    writeFileSync(path.join(root, 'src', 'new-thing.ts'), 'export const three = 3\n')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'the change under test')

    const result = await runGate(root, { DIFF_BASE: 'main' })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/PASS: this change touched no file the manifest declares/)
    // Named, not silently skipped: this is how a manifest that stopped
    // covering the code shows up while the gate is still green.
    expect(result.stdout).toContain('src/new-thing.ts')
    // And nothing about the file the base branch changed after the fork.
    expect(result.stdout).not.toContain('src/elsewhere.ts')
  })

  it('says which commit it compared against, so a pass can be checked (B8)', async () => {
    const root = repoWith(VALID_MANIFEST)
    writeFileSync(path.join(root, 'src', 'new-thing.ts'), 'export const three = 3\n')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'the change under test')

    const mergeBase = execFileSync('git', ['merge-base', 'main', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
    const result = await runGate(root, { DIFF_BASE: 'main' })
    expect(result.stdout).toContain(mergeBase)
  })

  it('fails when the run does not finish within its budget (B4, B7)', async () => {
    // Against this repository, because a budget can only be exceeded by a
    // runner that really starts. One second is far below the dry run, so the
    // runner is killed mid-measurement — the case the gate has to report as
    // "measured nothing" rather than as a report that never arrived.
    const result = await runGate(repoRoot, {
      MUTATION_ALL: '1',
      MUTATION_BUDGET_SECONDS: '1',
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/MUTATION_BUDGET_SECONDS=1/)
    expect(result.stderr).toMatch(/graded nothing/i)
  }, 60000)
})
