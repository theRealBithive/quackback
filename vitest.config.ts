import { coverageConfigDefaults, defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // GitHub-hosted ubuntu-latest is 4 vCPU. Default maxWorkers is ~50% of
    // cores, which leaves half the runner idle. Pin to 4 in CI; locally leave
    // headroom for the rest of the machine. Isolation stays on: turning it
    // off leaked vi.mock state across files (~200 failures on a shard).
    maxWorkers: process.env.CI ? 4 : undefined,
    fileParallelism: true,
    pool: 'forks',
    // Many server tests do a first-time dynamic import() inside the test body
    // (the vi.mock factory pattern). Under parallel CPU contention that load
    // can exceed the 5s default — and a timeout firing mid-import() corrupts
    // the module graph for later tests. 20s gives headroom; genuine hangs
    // still fail well before the suite stalls.
    testTimeout: 20000,
    include: ['**/*.test.ts', '**/*.test.tsx'],
    setupFiles: [path.resolve(__dirname, './vitest.setup.ts')],
    // Fails the run when REQUIRE_TEST_DB declared it complete and no usable
    // database answers, so a missing or stale schema cannot report as skips.
    globalSetup: [path.resolve(__dirname, './apps/web/vitest.global-setup.ts')],
    exclude: [
      '**/node_modules/**',
      '**/.next/**',
      '**/e2e/**',
      '**/.output/**',
      // Isolated git worktrees live here; they are separate checkouts with
      // their own deps and must not be run by the parent repo's suite.
      '**/.claude/**',
      '**/*-integration.test.ts',
      // Widget package has its own vitest.config.ts with happy-dom — run via
      // `bun run --cwd packages/widget test`. Don't double-run from the root.
      'packages/widget/**',
    ],
    // What the diff-coverage gate grades (`scripts/diff-coverage-check.ts`).
    // The scope lives here rather than in CI flags because it is a fact about
    // this repository, and because it has to be readable: a source file that
    // falls out of `include` is graded by nobody. The gate names every
    // source-looking file it could not grade, so an `include` that stops
    // matching shows up in the report of every run.
    coverage: {
      provider: 'v8',
      include: ['apps/web/src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts', 'scripts/**/*.ts'],
      exclude: [
        ...coverageConfigDefaults.exclude,
        // CLI entry points. They run as a spawned `bun` process, where an
        // in-process coverage provider cannot see them at all — measuring
        // them here would report 0% for code that its own end-to-end test
        // does execute. Their guarantees are covered by spawning them:
        // `scripts/__tests__/*-gate.test.ts`. The policy modules beside them
        // (`*-policy.ts`) hold the logic and are graded normally.
        'scripts/*-check.ts',
      ],
    },
    // Use ts-node or vite's transformation instead of stripping
    typecheck: {
      enabled: false,
    },
    env: {
      DATABASE_URL: 'postgresql://postgres:password@localhost:5432/quackback_test',
    },
    deps: {
      optimizer: {
        ssr: { enabled: true },
      },
    },
  },
  esbuild: {
    // Disable esbuild's strip-only mode to properly handle TypeScript features
    tsconfigRaw: {
      compilerOptions: {
        useDefineForClassFields: false,
      },
    },
  },
  resolve: {
    alias: {
      '@quackback/db/client': path.resolve(__dirname, './packages/db/src/client.ts'),
      '@quackback/db/schema-version': path.resolve(
        __dirname,
        './packages/db/src/schema-version.ts'
      ),
      '@quackback/db/schema-ops': path.resolve(__dirname, './packages/db/src/schema-ops.ts'),
      '@quackback/db/migrate': path.resolve(__dirname, './packages/db/src/migrate-runtime.ts'),
      '@quackback/db/schema': path.resolve(__dirname, './packages/db/src/schema/index.ts'),
      '@quackback/db/types': path.resolve(__dirname, './packages/db/src/types.ts'),
      '@quackback/db': path.resolve(__dirname, './packages/db/index.ts'),
      // Path alias for apps/web (matches tsconfig.json baseUrl: "./src" + "@/*": ["./*"])
      '@': path.resolve(__dirname, './apps/web/src'),
    },
  },
})
