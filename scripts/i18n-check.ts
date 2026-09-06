#!/usr/bin/env bun
/**
 * CI i18n gate: the catalogues must answer for everything the interface shows.
 *
 * The grading lives in `i18n-policy.ts` and is covered by
 * `__tests__/i18n-policy.test.ts`. This file is only the process around it: it
 * walks the source tree, reads the catalogues and the manifest, prints, and
 * picks an exit code.
 *
 * It exists because the parity test next to the catalogues compares the nine
 * files *to each other*. A key missing from all nine is therefore perfect
 * parity, and a key present in all nine with an empty value is too. Both are
 * invisible there and visible to a reader.
 *
 * Usage: bun scripts/i18n-check.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  gradeCatalogues,
  isShippedSource,
  mergeScans,
  scanSource,
  unusedExemptions,
  type CatalogueInput,
  type Exemption,
  type Finding,
  type SourceScan,
} from './i18n-policy'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// The three paths are overridable so the end-to-end test can point the gate at
// a fixture. Without that it could only assert against this repository's own
// current state, which is the thing the gate is meant to change.
const sourceRoot = process.env.I18N_SOURCE_ROOT ?? path.join(repoRoot, 'apps/web/src')
const localesDir = process.env.I18N_LOCALES_DIR ?? path.join(sourceRoot, 'locales')
const manifestPath = process.env.I18N_MANIFEST ?? path.join(repoRoot, 'scripts/i18n-manifest.json')

const DEFAULT_LOCALE = 'en'

/** Every file under the source root, so the policy decides what counts. */
function everyFile(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...everyFile(full))
    else out.push(full)
  }
  return out
}

function sourceFiles(root: string): string[] {
  return everyFile(root).filter((file) => isShippedSource(path.relative(root, file)))
}

function readCatalogues(): Record<string, Record<string, string>> {
  const catalogues: Record<string, Record<string, string>> = {}
  for (const entry of readdirSync(localesDir)) {
    if (!entry.endsWith('.json')) continue
    const locale = entry.slice(0, -'.json'.length)
    catalogues[locale] = JSON.parse(readFileSync(path.join(localesDir, entry), 'utf8'))
  }
  return catalogues
}

function readExemptions(): Exemption[] {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return (manifest.exemptions ?? []) as Exemption[]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

function describe(finding: Finding): string {
  const where = finding.file ? ` (${path.relative(repoRoot, finding.file)}:${finding.line})` : ''
  return `  - ${finding.id}${where}\n      ${finding.detail}`
}

function main(): number {
  const files = sourceFiles(sourceRoot)
  const scans: SourceScan[] = files.map((file) => scanSource(file, readFileSync(file, 'utf8')))
  const scan = mergeScans(scans)
  const catalogues = readCatalogues()
  const input: CatalogueInput = {
    scan,
    catalogues,
    defaultLocale: DEFAULT_LOCALE,
    exemptions: readExemptions(),
  }

  const locales = Object.keys(catalogues).sort()
  console.log(
    `Graded ${files.length} source file(s) against ${locales.length} catalogue(s): ${locales.join(', ')}.`
  )
  console.log(
    `Found ${scan.references.length} message reference(s), ${scan.assembled.length} assembled id pattern(s).`
  )

  const findings = gradeCatalogues(input)
  const removable = unusedExemptions(input)

  for (const kind of [
    'missing-from-catalogue',
    'unreferenced-key',
    'empty-without-english',
  ] as const) {
    const group = findings.filter((f) => f.kind === kind)
    if (group.length === 0) continue
    console.log(`\n${kind} (${group.length}):`)
    for (const finding of group) console.log(describe(finding))
  }

  if (removable.length > 0) {
    console.log(`\nExemptions that no longer excuse anything (${removable.length}), remove them:`)
    for (const exemption of removable) console.log(`  - ${exemption.id}`)
  }

  if (findings.length === 0) {
    console.log('\nPASS: every message the interface can show is answered for in every catalogue.')
    return 0
  }
  console.log(`\nFAIL: ${findings.length} finding(s).`)
  return 1
}

process.exit(main())
