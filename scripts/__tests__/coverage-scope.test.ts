/**
 * What the vitest run collects, and what the diff-coverage gate is allowed to
 * grade. Both are lists in `vitest.config.ts`, and both fail quietly when they
 * shrink, so both are asserted here in full.
 *
 * B7 A gate that could not measure fails rather than passes — no diff base,
 *    missing provider, budget exceeded.
 *
 * The coverage scope in `vitest.config.ts` decides which files reach a coverage
 * report at all, and a file that never reaches the report is graded by nobody:
 * `diff-coverage-check.ts` reports it as out of scope, and out of scope passes.
 * Narrowing the include is therefore a way to make the gate pass by measuring
 * less, and in a diff it looks like a config tidy-up.
 *
 * This test makes it look like something. It fails, and whoever changed the
 * scope has to change it here too and say why in the commit. It is the same
 * device the migration ledger uses: not a rule the code can enforce, but a
 * place where a quiet change has to become a loud one.
 *
 * It deliberately asserts the whole lists rather than "contains", because the
 * dangerous edit is a removal.
 */
import { describe, it, expect } from 'vitest'
import { coverageConfigDefaults } from 'vitest/config'
import rootConfig from '../../vitest.config'

/** The `test` block of the root config. */
function testScope(): { exclude?: string[] } {
  return ((rootConfig as { test?: unknown }).test ?? {}) as { exclude?: string[] }
}

/** The coverage block, whichever shape of vitest config holds it. */
function coverageScope(): { include?: string[]; exclude?: string[] } {
  const test = (rootConfig as { test?: { coverage?: unknown } }).test
  return (test?.coverage ?? {}) as { include?: string[]; exclude?: string[] }
}

describe('the coverage scope the gate grades against (B7)', () => {
  it('includes every directory that holds source, and nothing else', () => {
    expect(coverageScope().include).toEqual([
      'apps/web/src/**/*.{ts,tsx}',
      'packages/*/src/**/*.ts',
      'scripts/**/*.ts',
    ])
  })

  it('excludes vitest defaults plus the CLI entry points, and nothing else', () => {
    // The entry points run as a spawned process, where an in-process provider
    // sees nothing. Their own suites spawn them; see `*-gate.test.ts`.
    expect(coverageScope().exclude).toEqual([
      ...coverageConfigDefaults.exclude,
      'scripts/*-check.ts',
    ])
  })

  it('keeps the provider the gate can read a report from', () => {
    // The gate reads the istanbul-shaped `coverage-final.json` that both
    // providers write. Changing the provider is fine; dropping it is not.
    expect((coverageScope() as { provider?: string }).provider).toBe('v8')
  })
})

describe('what the run is allowed to collect', () => {
  it('never collects a mutation sandbox, which is a stale copy of this repository', () => {
    // Stryker copies the whole checkout into `.mutation-tmp/stryker/sandbox-*`
    // and applies a mutant to it. A crashed run leaves that copy behind, and
    // it holds a full second set of test files — so the next plain `vitest
    // run` collects both, grades source that is not the checkout, and fails
    // on assertions nobody wrote. Measured: a leftover sandbox reported four
    // failures from a test file that had already been restored.
    expect(testScope().exclude).toContain('**/.mutation-tmp/**')
  })

  it('excludes exactly the directories the run must not walk into', () => {
    // Asserted in full, because the dangerous edit is a removal.
    expect(testScope().exclude).toEqual([
      '**/node_modules/**',
      '**/.next/**',
      '**/e2e/**',
      '**/.output/**',
      '**/.claude/**',
      '**/.mutation-tmp/**',
      '**/*-integration.test.ts',
      'packages/widget/**',
    ])
  })
})
