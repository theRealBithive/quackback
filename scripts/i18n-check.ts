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
  gradeDisplayText,
  isShippedSource,
  mergeScans,
  scanDisplayText,
  scanSource,
  unclaimedPatterns,
  unusedExcuses,
  unusedExemptions,
  type CatalogueInput,
  type DisplayFinding,
  type DisplayScan,
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

function readManifest(): {
  claimedPrefixes: string[]
  exemptions: Exemption[]
  checkedFiles: string[]
} {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return {
      claimedPrefixes: (manifest.claimedPrefixes ?? []) as string[],
      exemptions: (manifest.exemptions ?? []) as Exemption[],
      checkedFiles: (manifest.checkedFiles ?? []) as string[],
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { claimedPrefixes: [], exemptions: [], checkedFiles: [] }
    throw error
  }
}

function describeDisplay(finding: DisplayFinding): string {
  const where = `${path.relative(repoRoot, finding.file)}:${finding.line}`
  const what = finding.text === '' ? '(no reason given)' : JSON.stringify(finding.text)
  return `  - ${what} (${where})\n      ${finding.detail}`
}

/**
 * A file the manifest names but that is not there any more fails the run
 * rather than being skipped. A list of paths is exactly the kind of list that
 * rots after a rename, and a missing file would otherwise be a file that
 * silently stopped being checked -- the way this gate would pass by checking
 * less.
 */
function readCheckedFiles(names: readonly string[]): { scans: DisplayScan[]; missing: string[] } {
  const scans: DisplayScan[] = []
  const missing: string[] = []
  for (const name of names) {
    // Resolved, not joined: an entry is repo-relative in this repository and
    // absolute in the end-to-end fixture, and `resolve` takes both.
    const full = path.resolve(repoRoot, name)
    try {
      scans.push(scanDisplayText(full, readFileSync(full, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      missing.push(name)
    }
  }
  return { scans, missing }
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
  const manifest = readManifest()
  const input: CatalogueInput = {
    scan,
    catalogues,
    defaultLocale: DEFAULT_LOCALE,
    exemptions: manifest.exemptions,
    claimedPrefixes: manifest.claimedPrefixes,
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

  // Every kind the policy can return. A kind graded and not printed fails the
  // run with a count and names nothing, which is a finding nobody can act on.
  for (const kind of [
    'missing-from-catalogue',
    'unanswered-pattern',
    'unreferenced-key',
    'empty-without-english',
    'blank-translation',
  ] as const) {
    const group = findings.filter((f) => f.kind === kind)
    if (group.length === 0) continue
    console.log(`\n${kind} (${group.length}):`)
    for (const finding of group) console.log(describe(finding))
  }

  const unclaimed = unclaimedPatterns(input)
  if (unclaimed.length > 0) {
    console.log(
      `\nNamespaces built at runtime that no catalogue answers, and that we do not claim yet (${unclaimed.length}):`
    )
    for (const pattern of unclaimed) {
      console.log(
        `  - ${pattern.pattern} (${path.relative(repoRoot, pattern.file)}:${pattern.line})`
      )
    }
    console.log('  Claim one in the manifest once its surface is translated.')
  }

  if (removable.length > 0) {
    console.log(`\nExemptions that no longer excuse anything (${removable.length}), remove them:`)
    for (const exemption of removable) console.log(`  - ${exemption.id}`)
  }

  // The second rule class, over the files the manifest claims hold no
  // untranslated text. It is a separate report because it is a separate
  // question: the rules above ask whether an id is answered for, this one asks
  // whether the text was written into the source instead of the catalogue.
  const { scans: displayScans, missing } = readCheckedFiles(manifest.checkedFiles)
  if (missing.length > 0) {
    // Reported as a finding with an exit code, not as a thrown stack: a gate
    // that crashes reads as broken, and this one has something to say.
    console.log(`\nFAIL: the manifest names ${missing.length} file(s) that are not there:`)
    for (const name of missing) console.log(`  - ${name}`)
    return 1
  }
  const displayFindings = gradeDisplayText(displayScans)
  const staleExcuses = unusedExcuses(displayScans)
  const displayStrings = displayScans.reduce((n, scan) => n + scan.strings.length, 0)
  console.log(
    `Checked ${manifest.checkedFiles.length} claimed file(s) for text of their own: ${displayStrings} readable string(s) found.`
  )

  for (const kind of ['untranslated-string', 'excuse-without-reason'] as const) {
    const group = displayFindings.filter((f) => f.kind === kind)
    if (group.length === 0) continue
    console.log(`\n${kind} (${group.length}):`)
    for (const finding of group) console.log(describeDisplay(finding))
  }

  if (staleExcuses.length > 0) {
    console.log(`\nNotes that no longer excuse anything (${staleExcuses.length}), remove them:`)
    for (const excuse of staleExcuses) {
      console.log(`  - ${path.relative(repoRoot, excuse.file)}:${excuse.line} — ${excuse.reason}`)
    }
  }

  const total = findings.length + displayFindings.length
  if (total === 0) {
    console.log(
      '\nPASS: every message the interface can show is answered for in every catalogue, and no claimed file holds text of its own.'
    )
    return 0
  }
  console.log(`\nFAIL: ${total} finding(s).`)
  return 1
}

process.exit(main())
