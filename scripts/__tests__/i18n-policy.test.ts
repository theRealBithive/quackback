/**
 * The i18n gate's catalogue rules, as guarantees rather than as code.
 *
 * These refine V6, V13, V14 and V16 of the confirmed language contract; the
 * V numbers each one serves are named in brackets. They are numbered I here
 * because the gate is a different artefact from the product it grades.
 *
 * I1 A message the interface can show, but that the shipped catalogue does not
 *    define, fails the run naming the file and the id — rather than quietly
 *    showing English to every reader in every language we offer. [V16]
 * I2 A message the catalogue carries but that nothing in the product can reach
 *    is reported as removable: it is translated into every language we ship
 *    and shown to nobody. [V16]
 * I3 An id the product reaches without carrying its English original along
 *    must read as real text in every language. A blank entry there does not
 *    fall back to English — it shows the reader the id itself. [V6]
 * I4 An id the product assembles at runtime counts as reached. A message the
 *    interface can show is never called removable merely because no line of
 *    source spells its id out in full. [V16]
 * I5 An id named in the source without its English original beside it counts
 *    as reached too: a label held in a table is still a label. [V16]
 * I6 An exemption names the id it excuses and why. An exemption without a
 *    reason is refused rather than honoured — an allowlist with no reason is
 *    how this gate would be silenced. [V14]
 * I7 An exemption that matches nothing is reported as removable and does not
 *    fail the run, so the list cannot rot into a list of stale claims. [V14]
 * I8 What the gate reads out of a source file is decided by where a name sits,
 *    not by what it looks like: an `id` on something that is not a message,
 *    and a word that merely resembles a key, are not references. [V13]
 * I9 What the gate reads at all is the source the product ships. A suite is
 *    not part of it, and a page is — including a page whose route name merely
 *    looks like a suite, which is a real shape here because routes are named
 *    flatly with dots. [V13]
 * I10 A blank entry is not a translation. Where an English original exists the
 *     reader is shown English instead of the language they chose; where none
 *     exists they are shown the id (I3). Both fail the run and the report says
 *     which, because they are not equally bad. [V6, V7]
 * I11 An id the product assembles at runtime, in a namespace we claim as
 *     translated, must have something in the catalogue it can resolve to. A
 *     pattern no key can satisfy shows English in every language we offer, and
 *     no id-by-id rule can see it: no line of source spells the id out, so I1
 *     has nothing to look up and I4 reads the pattern as proof of use. [V16]
 * I12 A namespace we have not claimed yet is reported by name rather than
 *     failing the run. Claiming one is what turns its coverage into a promise,
 *     and a claim can therefore only ever make the gate louder. [V14]
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  gradeCatalogues,
  isShippedSource,
  mergeScans,
  scanSource,
  unclaimedPatterns,
  unusedExemptions,
  type Exemption,
  type SourceScan,
} from '../i18n-policy'

const EMPTY_SCAN: SourceScan = { references: [], assembled: [], literals: [] }

function scanOf(partial: Partial<SourceScan>): SourceScan {
  return { ...EMPTY_SCAN, ...partial }
}

function ref(id: string, carriesEnglish: boolean, file = 'a.tsx', line = 1) {
  return { id, file, line, carriesEnglish }
}

/** Nine catalogues, all defining the same keys with the given values. */
function cataloguesOf(
  entries: Record<string, string>,
  overrides: Record<string, Record<string, string>> = {}
) {
  const locales = ['en', 'de', 'fr', 'es', 'ar', 'ru', 'pt-br', 'zh-cn', 'zh-tw']
  const out: Record<string, Record<string, string>> = {}
  for (const locale of locales) out[locale] = { ...entries, ...(overrides[locale] ?? {}) }
  return out
}

function grade(input: {
  scan?: SourceScan
  catalogues?: Record<string, Record<string, string>>
  exemptions?: Exemption[]
  claimedPrefixes?: readonly string[]
}) {
  return gradeCatalogues({
    scan: input.scan ?? EMPTY_SCAN,
    catalogues: input.catalogues ?? cataloguesOf({}),
    defaultLocale: 'en',
    exemptions: input.exemptions ?? [],
    claimedPrefixes: input.claimedPrefixes ?? [],
  })
}

/** An assembled-id scan for one pattern, at a nameable place. */
function assembledOf(pattern: string, file = 'selector.tsx', line = 7) {
  return scanOf({ assembled: [{ pattern, file, line }] })
}

describe('catalogue completeness (I1)', () => {
  it('reports an id the interface shows that no catalogue defines (I1)', () => {
    const findings = grade({
      scan: scanOf({ references: [ref('admin.inbox.title', true, 'inbox.tsx', 42)] }),
      catalogues: cataloguesOf({}),
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      kind: 'missing-from-catalogue',
      id: 'admin.inbox.title',
      file: 'inbox.tsx',
      line: 42,
    })
  })

  it('says nothing about an id the catalogue defines (I1)', () => {
    const findings = grade({
      scan: scanOf({ references: [ref('admin.inbox.title', true)] }),
      catalogues: cataloguesOf({ 'admin.inbox.title': 'Inbox' }),
    })
    expect(findings).toEqual([])
  })

  it('says which catalogue is silent about it (I1)', () => {
    const findings = grade({
      scan: scanOf({ references: [ref('admin.inbox.title', true)] }),
      catalogues: cataloguesOf({}),
    })
    expect(findings[0].detail).toContain('en.json')
  })

  it('points at the first place the id is used, not the last (I1)', () => {
    const findings = grade({
      scan: scanOf({
        references: [ref('a.one', true, 'first.tsx', 4), ref('a.one', true, 'later.tsx', 90)],
      }),
    })
    expect(findings[0]).toMatchObject({ file: 'first.tsx', line: 4 })
  })

  it('reports every undefined id exactly once, however often it is used (I1)', () => {
    const findings = grade({
      scan: scanOf({
        references: [
          ref('a.one', true, 'x.tsx', 1),
          ref('a.one', true, 'y.tsx', 9),
          ref('a.two', true, 'z.tsx', 3),
        ],
      }),
    })
    expect(
      findings
        .filter((f) => f.kind === 'missing-from-catalogue')
        .map((f) => f.id)
        .sort()
    ).toEqual(['a.one', 'a.two'])
  })
})

describe('keys nothing can reach (I2, I4, I5)', () => {
  it('reports a catalogue key no reference and no pattern reaches (I2)', () => {
    const findings = grade({ catalogues: cataloguesOf({ 'automation.test.title': 'Test agent' }) })
    expect(findings).toEqual([
      expect.objectContaining({ kind: 'unreferenced-key', id: 'automation.test.title' }),
    ])
  })

  it('says why a key nothing reaches is worth removing (I2)', () => {
    const findings = grade({ catalogues: cataloguesOf({ 'automation.test.title': 'Test agent' }) })
    expect(findings[0].detail).toContain('no source reference')
  })

  it('does not also call an unreachable key a blank translation (I2, I3)', () => {
    const findings = grade({
      catalogues: cataloguesOf({ 'dead.key': 'Dead' }, { ar: { 'dead.key': '' } }),
    })
    expect(findings.map((f) => f.kind)).toEqual(['unreferenced-key'])
  })

  it('treats a key the product assembles at runtime as reached (I4)', () => {
    const findings = grade({
      scan: scanOf({
        assembled: [{ pattern: 'activation.goal.*', file: 'getting-started.tsx', line: 197 }],
      }),
      catalogues: cataloguesOf({ 'activation.goal.firstReply': 'First reply' }),
    })
    expect(findings).toEqual([])
  })

  it('treats a key named in source without its English original as reached (I5)', () => {
    const findings = grade({
      scan: scanOf({ literals: ['automation.knowledge.source.posts.label'] }),
      catalogues: cataloguesOf({ 'automation.knowledge.source.posts.label': 'Posts' }),
    })
    expect(findings).toEqual([])
  })

  it('does not let a pattern reach a key outside it (I4)', () => {
    const findings = grade({
      scan: scanOf({ assembled: [{ pattern: 'activation.goal.*', file: 'x.tsx', line: 1 }] }),
      catalogues: cataloguesOf({ 'activation.other.thing': 'Nope' }),
    })
    expect(findings.map((f) => f.id)).toEqual(['activation.other.thing'])
  })
})

describe('blank translations (I3)', () => {
  it('reports a blank entry for an id that carries no English original (I3)', () => {
    const findings = grade({
      scan: scanOf({ references: [ref('automation.nav.agent', false, 'nav.tsx', 157)] }),
      catalogues: cataloguesOf(
        { 'automation.nav.agent': 'Agent' },
        { ar: { 'automation.nav.agent': '' } }
      ),
    })
    expect(findings).toEqual([
      expect.objectContaining({ kind: 'empty-without-english', id: 'automation.nav.agent' }),
    ])
    expect(findings[0].detail).toContain('ar')
  })

  it('calls a blank entry with an English original the milder finding, not this one (I3, I10)', () => {
    // This said `toEqual([])` while I3 was the only rule about blanks: a blank
    // that falls back to English shows the reader real words, so it was not a
    // defect of the kind I3 is about. I10 then made every blank a finding, and
    // the guarantee I3 still holds is the narrower one — that *this* kind is
    // reserved for the case where nothing can be fallen back on.
    const findings = grade({
      scan: scanOf({ references: [ref('automation.nav.label', true)] }),
      catalogues: cataloguesOf(
        { 'automation.nav.label': 'AI' },
        { ar: { 'automation.nav.label': '' } }
      ),
    })
    expect(findings.map((f) => f.kind)).toEqual(['blank-translation'])
  })

  it('treats whitespace as blank (I3)', () => {
    const findings = grade({
      scan: scanOf({ references: [ref('x.y', false)] }),
      catalogues: cataloguesOf({ 'x.y': 'X' }, { ru: { 'x.y': '   ' } }),
    })
    expect(findings.map((f) => f.kind)).toEqual(['empty-without-english'])
  })

  it('reports a blank entry for a key reached only by name (I3, I5)', () => {
    const findings = grade({
      scan: scanOf({ literals: ['automation.knowledge.source.posts.label'] }),
      catalogues: cataloguesOf(
        { 'automation.knowledge.source.posts.label': 'Posts' },
        { ar: { 'automation.knowledge.source.posts.label': '' } }
      ),
    })
    expect(findings.map((f) => f.kind)).toEqual(['empty-without-english'])
    expect(findings[0].file).toBeUndefined()
    expect(findings[0].line).toBeUndefined()
  })

  it('treats a language that does not define the key at all as blank (I3)', () => {
    const findings = grade({
      scan: scanOf({ references: [ref('x.y', false)] }),
      catalogues: { en: { 'x.y': 'X' }, de: {} },
    })
    expect(findings.map((f) => f.kind)).toEqual(['empty-without-english'])
    expect(findings[0].detail).toContain('de')
  })

  it('says what a reader would see instead of the text (I3)', () => {
    const findings = grade({
      scan: scanOf({ references: [ref('x.y', false)] }),
      catalogues: cataloguesOf({ 'x.y': 'X' }, { ar: { 'x.y': '' } }),
    })
    expect(findings[0].detail).toContain('defaultMessage')
  })

  it('names the blank languages in a settled order (I3)', () => {
    // `de` is written before `ar` in the fixture, so an unsorted list would
    // read "de, ar" — the order has to come from the report, not from the
    // order the catalogues happened to be read in.
    const findings = grade({
      scan: scanOf({ references: [ref('x.y', false)] }),
      catalogues: cataloguesOf({ 'x.y': 'X' }, { de: { 'x.y': '' }, ar: { 'x.y': '' } }),
    })
    expect(findings[0].detail).toContain('ar, de')
  })

  it('names every language that is blank, not only the first (I3)', () => {
    const findings = grade({
      scan: scanOf({ references: [ref('x.y', false)] }),
      catalogues: cataloguesOf({ 'x.y': 'X' }, { ru: { 'x.y': '' }, ar: { 'x.y': '' } }),
    })
    expect(findings[0].detail).toContain('ar')
    expect(findings[0].detail).toContain('ru')
  })
})

describe('blank translations that do fall back (I10)', () => {
  it('reports a blank entry for an id that carries its English original (I10)', () => {
    const findings = grade({
      scan: scanOf({ references: [ref('x.y', true, 'card.tsx', 12)] }),
      catalogues: cataloguesOf({ 'x.y': 'X' }, { de: { 'x.y': '' } }),
    })
    expect(findings).toEqual([
      expect.objectContaining({ kind: 'blank-translation', id: 'x.y', file: 'card.tsx', line: 12 }),
    ])
  })

  it('says the reader is shown English rather than their language (I10)', () => {
    const findings = grade({
      scan: scanOf({ references: [ref('x.y', true)] }),
      catalogues: cataloguesOf({ 'x.y': 'X' }, { de: { 'x.y': '' } }),
    })
    expect(findings[0].detail).toContain('English original')
    expect(findings[0].detail).toContain('de')
  })

  it('does not call the same id both broken and untranslated (I3, I10)', () => {
    const findings = grade({
      scan: scanOf({ references: [ref('x.y', false)] }),
      catalogues: cataloguesOf({ 'x.y': 'X' }, { de: { 'x.y': '' } }),
    })
    expect(findings.map((f) => f.kind)).toEqual(['empty-without-english'])
  })

  it('does not call an unreachable key untranslated (I2, I10)', () => {
    const findings = grade({
      catalogues: cataloguesOf({ 'dead.key': 'Dead' }, { de: { 'dead.key': '' } }),
    })
    expect(findings.map((f) => f.kind)).toEqual(['unreferenced-key'])
  })

  it('says nothing when every language reads as text (I10)', () => {
    const findings = grade({
      scan: scanOf({ references: [ref('x.y', true)] }),
      catalogues: cataloguesOf({ 'x.y': 'X' }),
    })
    expect(findings).toEqual([])
  })

  it('names the blank languages in a settled order (I10)', () => {
    const findings = grade({
      scan: scanOf({ references: [ref('x.y', true)] }),
      catalogues: cataloguesOf({ 'x.y': 'X' }, { de: { 'x.y': '' }, ar: { 'x.y': '' } }),
    })
    expect(findings[0].detail).toContain('ar, de')
  })

  it('treats a language that does not define the key at all as blank (I10)', () => {
    const findings = grade({
      scan: scanOf({ references: [ref('x.y', true)] }),
      catalogues: { en: { 'x.y': 'X' }, de: {} },
    })
    expect(findings.map((f) => f.kind)).toEqual(['blank-translation'])
  })
})

describe('exemptions (I6, I7)', () => {
  it('refuses to run on an exemption with no reason (I6)', () => {
    expect(() =>
      grade({
        catalogues: cataloguesOf({ 'dead.key': 'x' }),
        exemptions: [{ id: 'dead.key', reason: '  ' }],
      })
    ).toThrow(/reason/i)
  })

  it('honours an exemption that names a reason (I6)', () => {
    const findings = grade({
      catalogues: cataloguesOf({ 'dead.key': 'x' }),
      exemptions: [{ id: 'dead.key', reason: 'Kept for the 0.14 rollback path.' }],
    })
    expect(findings).toEqual([])
  })

  it('reports an exemption that matches nothing without failing the run (I7)', () => {
    const input = {
      scan: EMPTY_SCAN,
      catalogues: cataloguesOf({}),
      defaultLocale: 'en',
      claimedPrefixes: [],
      exemptions: [{ id: 'gone.key', reason: 'Was removed upstream.' }],
    }
    expect(gradeCatalogues(input)).toEqual([])
    expect(unusedExemptions(input)).toEqual([{ id: 'gone.key', reason: 'Was removed upstream.' }])
  })

  it('does not call an exemption removable while it still excuses something (I7)', () => {
    const input = {
      scan: EMPTY_SCAN,
      catalogues: cataloguesOf({ 'dead.key': 'x' }),
      defaultLocale: 'en',
      claimedPrefixes: [],
      exemptions: [{ id: 'dead.key', reason: 'Kept for the 0.14 rollback path.' }],
    }
    expect(unusedExemptions(input)).toEqual([])
  })

  it('refuses to list removable exemptions when one has no reason (I6, I7)', () => {
    expect(() =>
      unusedExemptions({
        scan: EMPTY_SCAN,
        catalogues: cataloguesOf({}),
        defaultLocale: 'en',
        claimedPrefixes: [],
        exemptions: [{ id: 'x.y', reason: '' }],
      })
    ).toThrow(/reason/i)
  })
})

describe('ids the product assembles at runtime (I11, I12)', () => {
  it('reports a claimed pattern the catalogue can satisfy with nothing (I11)', () => {
    const findings = grade({
      // A namespace that is not empty and still answers nothing: the pattern
      // needs a `.label` under it, and the one key there is reached by name.
      scan: scanOf({
        assembled: [
          { pattern: 'onboarding.goal.*.label', file: 'use-case-selector.tsx', line: 138 },
        ],
        literals: ['onboarding.goal.groupLabel'],
      }),
      catalogues: cataloguesOf({ 'onboarding.goal.groupLabel': 'Workspace goal' }),
      claimedPrefixes: ['onboarding.'],
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      kind: 'unanswered-pattern',
      id: 'onboarding.goal.*.label',
      file: 'use-case-selector.tsx',
      line: 138,
    })
    // And what it says, naming the catalogue that was searched. This is the
    // least self-explanatory of the five kinds -- "unanswered" means nothing
    // to a reader meeting it in a CI log for the first time.
    expect(findings[0].detail).toContain('no en.json key can satisfy it')
    expect(findings[0].detail).toContain('renders English')
  })

  it('accepts a claimed pattern one key already answers (I11)', () => {
    const findings = grade({
      scan: assembledOf('onboarding.step.*'),
      catalogues: cataloguesOf({ 'onboarding.step.1': 'Account' }),
      claimedPrefixes: ['onboarding.'],
    })
    expect(findings).toEqual([])
  })

  it('leaves an unclaimed namespace to the report rather than the exit code (I12)', () => {
    const scan = assembledOf('activation.task.*.*.title', 'getting-started.tsx', 432)
    const input = {
      scan,
      catalogues: cataloguesOf({}),
      defaultLocale: 'en',
      exemptions: [],
      claimedPrefixes: ['onboarding.'],
    }

    expect(gradeCatalogues(input)).toEqual([])
    expect(unclaimedPatterns(input)).toEqual([
      { pattern: 'activation.task.*.*.title', file: 'getting-started.tsx', line: 432 },
    ])
  })

  it('does not report a claimed namespace as unclaimed, whether or not it fails (I12)', () => {
    const claimed = {
      scan: assembledOf('onboarding.goal.*.label'),
      catalogues: cataloguesOf({}),
      defaultLocale: 'en',
      exemptions: [],
      claimedPrefixes: ['onboarding.'],
    }
    expect(unclaimedPatterns(claimed)).toEqual([])
  })

  it('reads a claim list of several prefixes one at a time (I12)', () => {
    const input = {
      scan: assembledOf('activation.task.*.title'),
      catalogues: cataloguesOf({}),
      defaultLocale: 'en',
      exemptions: [],
      claimedPrefixes: ['onboarding.', 'activation.'],
    }

    // Covered by the second entry, and that is enough: a namespace is claimed
    // when any prefix covers it, never only when every one of them does.
    expect(unclaimedPatterns(input)).toEqual([])
    expect(gradeCatalogues(input)).toHaveLength(1)
  })

  it('does not report a pattern the catalogue answers, claimed or not (I12)', () => {
    const answered = {
      scan: assembledOf('activation.goal.*'),
      catalogues: cataloguesOf({ 'activation.goal.support': 'Support' }),
      defaultLocale: 'en',
      exemptions: [],
      claimedPrefixes: [],
    }
    expect(unclaimedPatterns(answered)).toEqual([])
  })

  it('excuses a pattern the manifest names, with its reason (I6, I11)', () => {
    const findings = grade({
      scan: assembledOf('onboarding.goal.*.label'),
      catalogues: cataloguesOf({}),
      claimedPrefixes: ['onboarding.'],
      exemptions: [{ id: 'onboarding.goal.*.label', reason: 'Filled from the board name.' }],
    })
    expect(findings).toEqual([])
  })
})

describe('reading ids out of source (I8)', () => {
  it('finds a message and the English original beside it (I8)', () => {
    const scan = scanSource(
      'card.tsx',
      `export const C = () => <FormattedMessage id="admin.card.title" defaultMessage="Title" />`
    )
    expect(scan.references).toEqual([
      { id: 'admin.card.title', file: 'card.tsx', line: 1, carriesEnglish: true },
    ])
  })

  it('finds a message with no English original beside it (I8)', () => {
    const scan = scanSource(
      'card.tsx',
      `const C = () => <FormattedMessage id="admin.card.title" />`
    )
    expect(scan.references).toEqual([
      { id: 'admin.card.title', file: 'card.tsx', line: 1, carriesEnglish: false },
    ])
  })

  it('finds a message passed as an object to formatMessage (I8)', () => {
    const scan = scanSource(
      'nav.tsx',
      `const label = intl.formatMessage({ id: 'automation.nav.label', defaultMessage: 'AI' })`
    )
    expect(scan.references).toEqual([
      { id: 'automation.nav.label', file: 'nav.tsx', line: 1, carriesEnglish: true },
    ])
  })

  it('finds one formatted imperatively with no English original (I3, I8)', () => {
    const scan = scanSource(
      'nav.tsx',
      `const label = intl.formatMessage({ id: 'automation.nav.agent' })`
    )
    expect(scan.references).toEqual([
      { id: 'automation.nav.agent', file: 'nav.tsx', line: 1, carriesEnglish: false },
    ])
  })

  it('finds one formatted through a bare formatMessage call (I8)', () => {
    const scan = scanSource(
      'nav.tsx',
      `const label = formatMessage({ id: 'automation.nav.agent' })`
    )
    expect(scan.references.map((r) => r.id)).toEqual(['automation.nav.agent'])
  })

  it('does not read an element id as a message id (I8)', () => {
    const scan = scanSource('chart.tsx', 'const C = () => <div id="fill-area.gradient" />')
    expect(scan.references).toEqual([])
  })

  it('does not read an id on a namespaced element as a message id (I8)', () => {
    const scan = scanSource('x.tsx', 'const C = () => <Chart.Area id="a.b" defaultMessage="A" />')
    expect(scan.references.map((r) => r.id)).toEqual([])
  })

  it('does not read a message element that names no id (I8)', () => {
    const scan = scanSource('x.tsx', 'const C = () => <FormattedMessage defaultMessage="Title" />')
    expect(scan.references).toEqual([])
    expect(scan.assembled).toEqual([])
  })

  it('does not read an id that is not a plain string (I8)', () => {
    const scan = scanSource(
      'x.tsx',
      'const C = () => <FormattedMessage id={5} defaultMessage="A" />'
    )
    expect(scan.references).toEqual([])
  })

  it('does not read an id held in a variable (I8)', () => {
    const scan = scanSource('x.tsx', 'const C = ({ k }) => <FormattedMessage id={k} />')
    expect(scan.references).toEqual([])
    expect(scan.assembled).toEqual([])
  })

  it('does not treat an object handed to another function as a message (I8)', () => {
    const scan = scanSource('x.tsx', `const r = trackEvent({ id: 'row-1', name: 'First' })`)
    expect(scan.references).toEqual([])
  })

  it('does not treat a data row that has an id as a message (I8)', () => {
    const scan = scanSource('rows.ts', `const rows = [{ id: 'row-1', name: 'First' }]`)
    expect(scan.references).toEqual([])
  })

  it('records an assembled id as a pattern, not as a reference (I8)', () => {
    const scan = scanSource(
      'started.tsx',
      'const C = ({ o }) => <FormattedMessage id={`activation.goal.${o}`} />'
    )
    expect(scan.references).toEqual([])
    expect(scan.assembled).toEqual([{ pattern: 'activation.goal.*', file: 'started.tsx', line: 1 }])
  })

  it('records an assembled id given as an object descriptor (I4, I8)', () => {
    const scan = scanSource(
      'basics.tsx',
      'const d = ({ v }) => ({ id: `automation.voice.${v}.label`, defaultMessage: `x` })'
    )
    expect(scan.assembled).toEqual([
      { pattern: 'automation.voice.*.label', file: 'basics.tsx', line: 1 },
    ])
  })

  it('does not record an assembled element id as a message pattern (I8)', () => {
    const scan = scanSource('x.tsx', 'const C = ({ a }) => <div id={`connector-available-${a}`} />')
    expect(scan.assembled).toEqual([])
  })

  it('does not record an assembled id with no dot in it (I8)', () => {
    const scan = scanSource('x.tsx', 'const C = ({ a }) => <FormattedMessage id={`edge-${a}`} />')
    expect(scan.assembled).toEqual([])
  })

  it('records every string literal, so an id held in a table still counts (I5, I8)', () => {
    const scan = scanSource(
      'knowledge.tsx',
      `const sources = [{ labelId: 'automation.knowledge.source.posts.label' }]`
    )
    expect(scan.literals).toEqual(['automation.knowledge.source.posts.label'])
    expect(scan.references).toEqual([])
  })

  it('does not read the words between two tags as a message id (I8)', () => {
    const scan = scanSource('x.tsx', 'const C = () => <div>Save changes</div>')
    expect(scan.literals).toEqual([])
  })

  it('does not read a number written as an id as a message id (I8)', () => {
    const scan = scanSource(
      'x.tsx',
      'const C = () => <FormattedMessage id={5} defaultMessage="A" />'
    )
    expect(scan.literals).toEqual(['A'])
  })

  it('survives a call whose callee is neither a name nor a member (I8)', () => {
    const scan = scanSource('x.tsx', `const r = (a || b)({ id: 'x.y', defaultMessage: 'X' })`)
    expect(scan.references.map((r) => r.id)).toEqual(['x.y'])
  })

  it('survives a descriptor that names no id at all (I8)', () => {
    const scan = scanSource('x.tsx', `const d = { defaultMessage: 'Only English' }`)
    expect(scan.references).toEqual([])
  })

  it('reports the line a descriptor sits on (I1, I8)', () => {
    const scan = scanSource(
      'x.tsx',
      `const a = 1\nconst b = 2\nconst d = { id: 'x.y', defaultMessage: 'X' }`
    )
    expect(scan.references[0].line).toBe(3)
  })

  it('reports the line a reference sits on (I1, I8)', () => {
    const scan = scanSource('a.tsx', `\n\n<FormattedMessage id="x.y" defaultMessage="X" />`)
    expect(scan.references[0].line).toBe(3)
  })

  it('reports the line an assembled pattern sits on (I4, I8)', () => {
    const scan = scanSource('a.tsx', `\n\n\n<FormattedMessage id={\`x.\${y}\`} />`)
    expect(scan.assembled[0].line).toBe(4)
  })
})

describe('merging what several files said (I8)', () => {
  it('keeps every reference and every pattern, and names each literal once (I8)', () => {
    const a = scanSource('a.tsx', `<FormattedMessage id="a.one" defaultMessage="A" />`)
    const b = scanSource(
      'b.tsx',
      'const C = ({ k }) => <FormattedMessage id={`b.two.${k}`} />\nconst s = "a.one"'
    )
    const merged = mergeScans([a, b])
    expect(merged.references).toEqual([
      { id: 'a.one', file: 'a.tsx', line: 1, carriesEnglish: true },
    ])
    expect(merged.assembled).toEqual([{ pattern: 'b.two.*', file: 'b.tsx', line: 1 }])
    expect(merged.literals.filter((l) => l === 'a.one')).toHaveLength(1)
  })

  it('says nothing about a tree with no files (I8)', () => {
    expect(mergeScans([])).toEqual({ references: [], assembled: [], literals: [] })
  })
})

describe('what the gate reads at all (I9)', () => {
  it('reads a component and a route (I9)', () => {
    expect(isShippedSource('components/admin/admin-sidebar.tsx')).toBe(true)
    expect(isShippedSource('routes/admin/inbox.tsx')).toBe(true)
    expect(isShippedSource('lib/shared/i18n.ts')).toBe(true)
  })

  it('does not read a suite (I9)', () => {
    expect(isShippedSource('components/admin/__tests__/admin-sidebar.test.tsx')).toBe(false)
    expect(isShippedSource('lib/client/queries/conversation-keys.test.ts')).toBe(false)
    expect(isShippedSource('components/admin/feedback/post-timeline.test.tsx')).toBe(false)
  })

  it('reads a route whose flat name looks like a suite (I9)', () => {
    // `/admin/automation/test` is the page, and 64 catalogue keys live on it.
    expect(isShippedSource('routes/admin/automation.test.tsx')).toBe(true)
  })

  it('does not read a suite that sits inside the routes tree (I9)', () => {
    expect(isShippedSource('routes/admin/__tests__/inbox.test.tsx')).toBe(false)
  })

  it('does not read the catalogues themselves, or anything generated (I9)', () => {
    expect(isShippedSource('locales/en.json')).toBe(false)
    expect(isShippedSource('locales/messages.ts')).toBe(false)
    expect(isShippedSource('routeTree.gen.ts')).toBe(false)
  })

  it('does not read what is not TypeScript (I9)', () => {
    expect(isShippedSource('styles/app.css')).toBe(false)
    expect(isShippedSource('components/admin/logo.svg')).toBe(false)
  })
})

describe('properties', () => {
  const idArb = fc
    .tuple(fc.constantFrom('admin', 'portal', 'widget'), fc.stringMatching(/^[a-z]{1,8}$/))
    .map(([a, b]) => `${a}.${b}`)

  it('claiming a namespace can only make the gate louder (I12)', () => {
    // The promise a claim makes is one-way. If claiming could silence a
    // finding, the manifest would be a way to pass by claiming more, which is
    // the mirror image of passing by grading less.
    fc.assert(
      fc.property(
        fc.array(idArb, { maxLength: 4 }),
        fc.array(idArb, { maxLength: 4 }),
        fc.array(fc.constantFrom('onboarding.', 'activation.', 'admin.'), { maxLength: 3 }),
        (used, defined, claimedPrefixes) => {
          const scan = scanOf({
            references: used.map((u) => ref(u, true)),
            assembled: defined.map((d, index) => ({
              pattern: `${d.split('.')[0]}.*`,
              file: 'x.tsx',
              line: index + 1,
            })),
          })
          const catalogues = cataloguesOf(Object.fromEntries(defined.map((d) => [d, 'text'])))
          const base = gradeCatalogues({
            scan,
            catalogues,
            defaultLocale: 'en',
            exemptions: [],
            claimedPrefixes: [],
          })
          const withClaims = gradeCatalogues({
            scan,
            catalogues,
            defaultLocale: 'en',
            exemptions: [],
            claimedPrefixes,
          })
          const after = new Set(withClaims.map((f) => `${f.kind}\u0000${f.id}`))
          return base.every((f) => after.has(`${f.kind}\u0000${f.id}`))
        }
      )
    )
  })

  it('an id reached in any of the three ways is never called removable (I2, I4, I5)', () => {
    fc.assert(
      fc.property(idArb, fc.constantFrom('reference', 'literal', 'assembled'), (id, how) => {
        const scan = scanOf(
          how === 'reference'
            ? { references: [ref(id, true)] }
            : how === 'literal'
              ? { literals: [id] }
              : { assembled: [{ pattern: `${id.split('.')[0]}.*`, file: 'x', line: 1 }] }
        )
        const findings = gradeCatalogues({
          scan,
          catalogues: cataloguesOf({ [id]: 'text' }),
          defaultLocale: 'en',
          claimedPrefixes: [],
          exemptions: [],
        })
        return findings.every((f) => f.kind !== 'unreferenced-key')
      })
    )
  })

  it('rewording a translation never changes what the gate reports (I1, I2, I3)', () => {
    fc.assert(
      fc.property(
        idArb,
        fc.string({ minLength: 1 }).filter((s) => s.trim() !== ''),
        (id, text) => {
          const scan = scanOf({ references: [ref(id, false)] })
          const base = gradeCatalogues({
            scan,
            catalogues: cataloguesOf({ [id]: 'original' }),
            defaultLocale: 'en',
            claimedPrefixes: [],
            exemptions: [],
          })
          const reworded = gradeCatalogues({
            scan,
            catalogues: cataloguesOf({ [id]: 'original' }, { de: { [id]: text } }),
            defaultLocale: 'en',
            claimedPrefixes: [],
            exemptions: [],
          })
          return JSON.stringify(base) === JSON.stringify(reworded)
        }
      )
    )
  })

  it('a reasonless exemption is refused whatever else is true (I6)', () => {
    fc.assert(
      fc.property(idArb, fc.stringMatching(/^\s*$/), (id, blank) => {
        try {
          gradeCatalogues({
            scan: scanOf({ references: [ref(id, true)] }),
            catalogues: cataloguesOf({ [id]: 'text' }),
            defaultLocale: 'en',
            claimedPrefixes: [],
            exemptions: [{ id, reason: blank }],
          })
          return false
        } catch {
          return true
        }
      })
    )
  })

  it('every finding names an id the run actually knows about (I1, I2, I3)', () => {
    fc.assert(
      fc.property(
        fc.array(idArb, { maxLength: 6 }),
        fc.array(idArb, { maxLength: 6 }),
        (used, defined) => {
          const catalogues = cataloguesOf(Object.fromEntries(defined.map((d) => [d, 'text'])))
          const findings = gradeCatalogues({
            scan: scanOf({ references: used.map((u) => ref(u, true)) }),
            catalogues,
            defaultLocale: 'en',
            claimedPrefixes: [],
            exemptions: [],
          })
          const known = new Set([...used, ...defined])
          return findings.every((f) => known.has(f.id))
        }
      )
    )
  })
})
