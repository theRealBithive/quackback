/**
 * The route-tree generator, which is what makes `typecheck` mean anything.
 *
 * `src/routeTree.gen.ts` is generated and gitignored, and without it a clean
 * tree typechecks with hundreds of errors in `src/routes/**`. That number was
 * treated as a baseline to count against, and it hid a real regression: five
 * new errors read as "the baseline drifted".
 *
 * CI cannot notice if this script stops working, which is the reason for this
 * file. The `check` job builds before it typechecks, and the build writes the
 * same route tree — so a generator that silently produced nothing would be
 * masked there and would only surface on somebody's laptop, as the return of
 * the number this change exists to remove.
 *
 * G1 Running the generator produces the typed route tree, from nothing.
 * G2 It says so and fails when it does not, rather than leaving a typecheck to
 *    run against a route tree that was never written.
 */
import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const ROUTE_TREE = join(APP_DIR, 'src', 'routeTree.gen.ts')
const PARKED = `${ROUTE_TREE}.parked-by-test`

function runGenerator(): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('bun', ['scripts/generate-route-tree.ts'], { cwd: APP_DIR })
    let output = ''
    child.stdout.on('data', (chunk) => (output += String(chunk)))
    child.stderr.on('data', (chunk) => (output += String(chunk)))
    child.on('close', (code) => resolve({ code: code ?? -1, output }))
  })
}

describe('the route-tree generator', () => {
  it('writes the typed route tree from nothing (G1, G2)', { timeout: 120_000 }, async () => {
    // Move the existing tree aside rather than trusting one to be there: the
    // guarantee is that the generator *produces* the file, and a test that
    // only ever sees a file somebody else wrote cannot tell the difference.
    //
    // The file is absent for the ~3 seconds this takes, which is safe because
    // the only module that imports it is `src/router.tsx` and no test imports
    // that (checked). If a suite elsewhere ever starts failing intermittently
    // on a missing `routeTree.gen`, this window is why.
    const hadOne = existsSync(ROUTE_TREE)
    if (hadOne) renameSync(ROUTE_TREE, PARKED)

    try {
      const { code, output } = await runGenerator()

      expect(output).not.toContain('wrote no route tree')
      expect(code).toBe(0)
      expect(existsSync(ROUTE_TREE)).toBe(true)
      expect(statSync(ROUTE_TREE).size).toBeGreaterThan(0)
    } finally {
      if (hadOne && existsSync(PARKED)) {
        if (existsSync(ROUTE_TREE)) unlinkSync(ROUTE_TREE)
        renameSync(PARKED, ROUTE_TREE)
      }
    }
  })
})
