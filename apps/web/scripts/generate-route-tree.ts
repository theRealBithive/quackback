/**
 * Write `src/routeTree.gen.ts`, the typed route tree, without a full build.
 *
 * The file is generated and gitignored, and TypeScript needs it: without it
 * every `createFileRoute('/…')` call has no registered route to match, and
 * `bun run typecheck` reports hundreds of errors in `src/routes/**` on a clean
 * tree. That number was treated as a baseline to count against for five
 * separate pieces of work, and it hid a real regression at least once — a
 * count is not a measurement, and comparing two counts is not a check.
 *
 * Only the build and the dev server used to produce it, and neither is a
 * reasonable prerequisite for a typecheck: the web build takes about 55
 * seconds. But the route tree is written while Vite resolves its config, long
 * before anything is bundled, so resolving the config alone is enough — 3
 * seconds, and byte-identical to what `bun run build` writes.
 *
 * The explicit `process.exit(0)` is load-bearing. Resolving the config leaves
 * plugin file watchers open, so the process hangs at the end of the script with
 * the work already done; measured, it sat there until killed at 90 seconds.
 */
import { resolveConfig } from 'vite'
import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const ROUTE_TREE = join(APP_DIR, 'src', 'routeTree.gen.ts')

// The app's own config validation is not involved in generating a file, and it
// would fail here for want of a secret key.
process.env.SKIP_ENV_VALIDATION ??= 'true'

await resolveConfig(
  { configFile: join(APP_DIR, 'vite.config.ts'), root: APP_DIR },
  'serve',
  'development',
  'development'
)

// Fail loudly rather than let a typecheck run against a route tree that was
// never written. A silent no-op here would restore exactly the situation this
// script exists to end.
if (!existsSync(ROUTE_TREE) || statSync(ROUTE_TREE).size === 0) {
  console.error(
    `Vite resolved its config but wrote no route tree at ${ROUTE_TREE}.\n` +
      'The TanStack Start plugin generates it during config resolution; if that ' +
      'moved, `bun run build` still writes the file and typecheck will pass, but ' +
      'this script needs updating.'
  )
  process.exit(1)
}

process.exit(0)
