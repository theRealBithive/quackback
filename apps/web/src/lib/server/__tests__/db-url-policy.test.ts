import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * No test file may name the dev database.
 *
 * Contract: V7 in `db-fixture-infra-gate.test.ts` — tests never silently fall
 * back to a database other than the one they were told to use.
 *
 * Six suites used to carry their own candidate list:
 *
 *   const CANDIDATE_URLS = [
 *     process.env.DATABASE_URL,
 *     'postgresql://postgres:password@localhost:5432/quackback',
 *   ].filter(...)
 *
 * and walked it until one connected. Those suites insert rows. So a run whose
 * configured database was merely unreachable did not skip and did not fail — it
 * wrote into the developer's dev database and reported a pass, against data
 * nobody had told it to use. That is worse than a suite that never ran.
 *
 * The rule is about the literal rather than about the fallback, because a
 * fallback is not reliably recognisable in text while the credential is. The
 * default-when-unset that V7 does allow stays available as `DEV_DATABASE_URL`
 * from the fixture, which is one import and cannot grow a second candidate.
 *
 * Deliberately not banned: URLs that are string fixtures for parsing
 * (`postgresql://u@localhost:5432/control` and friends). They name no reachable
 * database, and a rule broad enough to catch them would be turned off.
 */

/** The dev database, as `DEV_DATABASE_URL` in `db-test-fixture.ts` spells it. */
const DEV_DB_URL = 'postgresql://postgres:password@localhost:5432/quackback'

/** Every tracked `*.test.ts` under `dir`, skipping build and vendor output. */
function testFiles(dir: string): string[] {
  const SKIP = new Set(['node_modules', '.git', 'dist', '.output', '.stryker-tmp', 'coverage'])
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...testFiles(full))
    } else if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) {
      found.push(full)
    }
  }
  return found
}

const repoRoot = join(__dirname, '../../../../../..')

describe('the dev database is not a test target (V7)', () => {
  it('no test file names it', () => {
    const offenders: string[] = []

    for (const file of testFiles(repoRoot)) {
      // This file quotes the banned URL on purpose — as the documentation of
      // what went wrong, and as the control below.
      if (file.endsWith('db-url-policy.test.ts')) continue
      const source = readFileSync(file, 'utf8')
      if (!source.includes(DEV_DB_URL)) continue
      // `quackback_test` starts with the dev name; only a boundary is a hit.
      for (const match of source.matchAll(new RegExp(`${DEV_DB_URL}(?![\\w-])`, 'g'))) {
        offenders.push(`${file.replace(repoRoot, '.')}: ${match[0]}`)
      }
    }

    expect(offenders).toEqual([])
  })

  // The control: an empty result above has to mean "none present" rather than
  // "the matcher never matches anything".
  it('recognises the URL it bans, and leaves the test database alone', () => {
    const banned = `const CANDIDATE_URLS = ['${DEV_DB_URL}']`
    const allowed = `const url = '${DEV_DB_URL}_test'`
    const pattern = new RegExp(`${DEV_DB_URL}(?![\\w-])`, 'g')

    expect([...banned.matchAll(pattern)]).toHaveLength(1)
    expect([...allowed.matchAll(pattern)]).toHaveLength(0)
  })

  it('scans a plausible number of files, so a broken walk cannot pass as clean', () => {
    // A walk that returned nothing would satisfy the check above vacuously.
    expect(testFiles(repoRoot).length).toBeGreaterThan(500)
  })
})
