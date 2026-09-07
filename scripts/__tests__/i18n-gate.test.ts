/**
 * The i18n gate, as a process.
 *
 * Contract: I1, I2 and I3 in `i18n-policy.test.ts`. The policy module is unit
 * tested; this file exists because the wiring is its own failure surface — the
 * gate has to find the source files, read nine catalogues, and turn findings
 * into an exit code, and none of that is graded by importing the policy.
 *
 * It runs against a fixture rather than against this repository, so it says the
 * same thing before and after the catalogues are repaired. A test that asserted
 * the real tree would have to be edited every time a message is added, which is
 * how a gate test stops meaning anything.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const gate = path.join(repoRoot, 'scripts/i18n-check.ts')

let fixtureRoot: string

/** A source tree and its catalogues, written fresh for each case. */
function writeFixture(
  name: string,
  source: string,
  catalogues: Record<string, Record<string, string>>,
  claimedPrefixes: readonly string[] = []
) {
  const root = path.join(fixtureRoot, name)
  const src = path.join(root, 'src')
  const locales = path.join(root, 'locales')
  mkdirSync(src, { recursive: true })
  mkdirSync(locales, { recursive: true })
  writeFileSync(path.join(src, 'card.tsx'), source)
  for (const [locale, entries] of Object.entries(catalogues)) {
    writeFileSync(path.join(locales, `${locale}.json`), JSON.stringify(entries, null, 2))
  }
  writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({ claimedPrefixes, exemptions: [] })
  )
  return { src, locales, manifest: path.join(root, 'manifest.json') }
}

function runGate(paths: { src: string; locales: string; manifest: string }): Promise<{
  exitCode: number | null
  stdout: string
}> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', [gate], {
      cwd: repoRoot,
      env: {
        ...process.env,
        I18N_SOURCE_ROOT: paths.src,
        I18N_LOCALES_DIR: paths.locales,
        I18N_MANIFEST: paths.manifest,
      },
    })
    let stdout = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.on('error', reject)
    child.on('close', (exitCode) => resolve({ exitCode, stdout }))
  })
}

beforeAll(() => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), 'i18n-gate-'))
})

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

describe('the i18n gate as a process', () => {
  it('passes a tree whose catalogues answer for every message (I1)', async () => {
    const paths = writeFixture(
      'clean',
      `export const C = () => <FormattedMessage id="admin.card.title" defaultMessage="Title" />`,
      { en: { 'admin.card.title': 'Title' }, de: { 'admin.card.title': 'Titel' } }
    )
    const { exitCode, stdout } = await runGate(paths)
    expect(stdout).toContain('PASS')
    expect(exitCode).toBe(0)
  })

  it('fails and names a message no catalogue defines (I1)', async () => {
    const paths = writeFixture(
      'missing',
      `export const C = () => <FormattedMessage id="admin.card.title" defaultMessage="Title" />`,
      { en: {}, de: {} }
    )
    const { exitCode, stdout } = await runGate(paths)
    expect(stdout).toContain('missing-from-catalogue')
    expect(stdout).toContain('admin.card.title')
    expect(stdout).toContain('card.tsx')
    expect(exitCode).toBe(1)
  })

  it('fails and names a catalogue key nothing can reach (I2)', async () => {
    const paths = writeFixture('dead', `export const C = () => null`, {
      en: { 'admin.card.gone': 'Gone' },
      de: { 'admin.card.gone': 'Weg' },
    })
    const { exitCode, stdout } = await runGate(paths)
    expect(stdout).toContain('unreferenced-key')
    expect(stdout).toContain('admin.card.gone')
    expect(exitCode).toBe(1)
  })

  it('names a blank translation the reader is shown English for (I10)', async () => {
    // Graded from the first version of this gate and printed by none of it:
    // the run failed with a count and named nothing, which is a finding you
    // cannot act on. Found while hand-authoring nine catalogues, where a
    // single blank entry is exactly the mistake to expect.
    const paths = writeFixture(
      'blank-with-english',
      `export const C = () => <FormattedMessage id="admin.card.title" defaultMessage="Title" />`,
      { en: { 'admin.card.title': 'Title' }, de: { 'admin.card.title': '' } }
    )
    const { exitCode, stdout } = await runGate(paths)
    expect(stdout).toContain('blank-translation')
    expect(stdout).toContain('admin.card.title')
    expect(stdout).toContain('de')
    expect(exitCode).toBe(1)
  })

  it('fails and names a claimed pattern no key can answer (I11)', async () => {
    const paths = writeFixture(
      'unanswered',
      'export const C = ({ k }) => <FormattedMessage id={`onboarding.goal.${k}.label`} />',
      { en: {}, de: {} },
      ['onboarding.']
    )
    const { exitCode, stdout } = await runGate(paths)
    expect(stdout).toContain('unanswered-pattern')
    expect(stdout).toContain('onboarding.goal.*.label')
    expect(stdout).toContain('card.tsx')
    // And why, naming the catalogue it looked in. A report that says only
    // which line is wrong leaves the reader to work out what "unanswered"
    // means, and the whole point of the kind is that it is not obvious.
    expect(stdout).toContain('no en.json key can satisfy it')
    expect(stdout).toContain('renders English')
    expect(exitCode).toBe(1)
  })

  it('names an unclaimed namespace without failing on it (I12)', async () => {
    const paths = writeFixture(
      'unclaimed',
      'export const C = ({ k }) => <FormattedMessage id={`activation.task.${k}.title`} />',
      { en: {}, de: {} }
    )
    const { exitCode, stdout } = await runGate(paths)
    expect(stdout).toContain('activation.task.*.title')
    expect(stdout).toContain('PASS')
    expect(exitCode).toBe(0)
  })

  it('fails and names a blank translation a reader would see as an id (I3)', async () => {
    const paths = writeFixture(
      'blank',
      `const rows = [{ labelId: 'admin.card.label' }]\nexport const C = () => rows`,
      { en: { 'admin.card.label': 'Label' }, de: { 'admin.card.label': '' } }
    )
    const { exitCode, stdout } = await runGate(paths)
    expect(stdout).toContain('empty-without-english')
    expect(stdout).toContain('admin.card.label')
    expect(stdout).toContain('de')
    expect(exitCode).toBe(1)
  })
})
