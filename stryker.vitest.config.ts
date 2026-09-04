import { defineConfig } from 'vitest/config'

/**
 * The vitest configuration Stryker runs the suite under.
 *
 * It exists to keep the dry run small. Stryker's vitest runner executes the
 * whole suite once before it mutates anything, to learn which test covers which
 * line — under the root config that is all 1405 test files, for a mutation run
 * that touches one module. `include` here is the selection, so the dry run only
 * ever loads the suites that can reach the code under test.
 *
 * `globalSetup` is deliberately absent: the test-database gate has nothing to
 * say about these files, and every mutant would otherwise pay for a database
 * probe.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    include: ['scripts/__tests__/audit-policy.test.ts'],
  },
})
