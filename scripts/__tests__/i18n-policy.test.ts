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
 * I13 A key that something more specific already accounts for is not evidence
 *     that a pattern resolves. A source line naming the key outright accounts
 *     for it, and so does a narrower pattern -- narrower meaning it leaves
 *     less to be filled in at runtime. Without this a namespace reads as
 *     answered because of its neighbours: `activation.goal.*` is satisfied by
 *     `activation.goal.label`, which another line names by hand, while
 *     `activation.goal.product_feedback` resolves to nothing. The report gets
 *     shorter as the hole gets bigger, which is the direction nobody checks.
 *     [V16]
 *
 * I14 to I20 are the second rule class: not "is this id answered for", but
 * "was this text written into the source instead of the catalogue". The two
 * are independent, and only the first was built at the time -- so V13 was a
 * claim with nothing enforcing it, and a string added to a translated surface
 * after the fact was shown in English to every reader in every language while
 * the gate stayed green.
 *
 * I14 A word a reader can see, written into a claimed file rather than into
 *     the catalogue, fails the run naming the file, the line and the word.
 *     [V13]
 * I15 What counts as a word a reader can see is decided by where it sits, not
 *     by what it looks like: text between tags, the value of one of the few
 *     attributes a person actually reads (a tooltip, a name a screen reader
 *     announces, a placeholder, the text behind an image), and a message
 *     handed to something whose whole job is to show it -- a toast, a browser
 *     prompt. A class name, a URL in a link, an icon name and a node type are
 *     not that, however English they look. [V13]
 * I16 A file is checked because the manifest names it, not because of where it
 *     lives. Adding one asserts that it holds no untranslated text, and the
 *     list is asserted in full, so it cannot shrink into a shorter report.
 *     [V14]
 * I17 A string that genuinely must not be translated -- a product name, a
 *     specimen URL, a code example -- is excused by a note at the line itself,
 *     with the reason. An excuse without a reason is refused rather than
 *     honoured, for the same reason an exemption is. At the line and not in
 *     the manifest, so it travels with the line and retires when the line is
 *     edited. [V14]
 * I18 An excuse that matches nothing is reported as removable and does not
 *     fail the run, so the notes cannot rot into a list of stale claims. [V14]
 * I19 Something with no word in it is not text: a separator, a number, a
 *     symbol. The rule is about language, and a rule that flags an em dash
 *     teaches people to switch it off. [V13]
 * I20 A value the source does not contain is not a string this rule can ask
 *     for. Where a sentence the product owns carries a person's own words
 *     inside it, the rule holds the sentence and never the words. [V13, V17]
 *
 * V17 is the guarantee those last two serve, and it is the reader's side of
 * the same thing: text a person wrote is shown as they wrote it. Nothing a
 * user brings in -- what they type, a link they paste, a name, a file they
 * uploaded -- is translated, reworded, or rewritten into one of our sentences.
 * Where our own frame surrounds their words, the frame is translated and their
 * words are not.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  gradeCatalogues,
  gradeDisplayText,
  scanDisplayText,
  unusedExcuses,
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

describe('what counts as evidence that a pattern resolves (I13)', () => {
  it('does not let a key the source names by hand answer a pattern (I13)', () => {
    // The shape this was found in: `activation.goal.label` is a heading one
    // line spells out, and it happens to sit under the same wildcard as
    // `activation.goal.${outcome}`. The outcome ids exist nowhere.
    const findings = grade({
      scan: scanOf({
        assembled: [{ pattern: 'activation.goal.*', file: 'getting-started.tsx', line: 197 }],
        references: [ref('activation.goal.label', true, 'getting-started.tsx', 193)],
      }),
      catalogues: cataloguesOf({ 'activation.goal.label': 'Current goal' }),
      claimedPrefixes: ['activation.'],
    })

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      kind: 'unanswered-pattern',
      id: 'activation.goal.*',
      line: 197,
    })
  })

  it('counts an indirectly named key as spoken for too (I5, I13)', () => {
    // I5 already treats a bare literal as reaching a key. It names the key
    // just as exactly as an `id` does, so it accounts for it here as well.
    const findings = grade({
      scan: scanOf({
        assembled: [{ pattern: 'activation.goal.*', file: 'getting-started.tsx', line: 197 }],
        literals: ['activation.goal.label'],
      }),
      catalogues: cataloguesOf({ 'activation.goal.label': 'Current goal' }),
      claimedPrefixes: ['activation.'],
    })

    expect(findings).toHaveLength(1)
    expect(findings[0]!.id).toBe('activation.goal.*')
  })

  it('does not let a narrower pattern answer the wider one over it (I13)', () => {
    // Both are real lines of the same page. Filling in the titles is what
    // makes the wider one stop reporting -- while `blocked`, `description`,
    // `action` and `completedAction`, the four suffixes it actually resolves
    // to, still exist nowhere.
    const findings = grade({
      scan: scanOf({
        assembled: [
          { pattern: 'activation.task.*.*.title', file: 'getting-started.tsx', line: 535 },
          { pattern: 'activation.task.*.*.*', file: 'getting-started.tsx', line: 570 },
        ],
      }),
      catalogues: cataloguesOf({
        'activation.task.internal.create-board.title': 'Create a private team board',
      }),
      claimedPrefixes: ['activation.'],
    })

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      kind: 'unanswered-pattern',
      id: 'activation.task.*.*.*',
      line: 570,
    })
  })

  it('keeps the key as evidence for the narrower pattern that claims it (I13)', () => {
    const findings = grade({
      scan: assembledOf('activation.task.*.*.title', 'getting-started.tsx', 535),
      catalogues: cataloguesOf({
        'activation.task.internal.create-board.title': 'Create a private team board',
      }),
      claimedPrefixes: ['activation.'],
    })

    expect(findings).toEqual([])
  })

  it('accepts a key that nothing more specific accounts for (I13)', () => {
    const findings = grade({
      scan: assembledOf('activation.goal.*', 'getting-started.tsx', 197),
      catalogues: cataloguesOf({ 'activation.goal.product_feedback': 'Product feedback' }),
      claimedPrefixes: ['activation.'],
    })

    expect(findings).toEqual([])
  })

  it('reports the pattern rather than the key it refused as evidence (I13)', () => {
    // The key is fine: it is defined, it is reached, and it is translated.
    // Only the pattern is a finding, so the report says what to fix.
    const findings = grade({
      scan: scanOf({
        assembled: [{ pattern: 'activation.goal.*', file: 'getting-started.tsx', line: 197 }],
        references: [ref('activation.goal.label', true, 'getting-started.tsx', 193)],
      }),
      catalogues: cataloguesOf({ 'activation.goal.label': 'Current goal' }),
      claimedPrefixes: ['activation.'],
    })

    expect(findings.map((f) => f.id)).toEqual(['activation.goal.*'])
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

  const segmentArb = fc.stringMatching(/^[a-z]{1,8}$/)

  it('keys the source names by hand never rescue the pattern over them (I13)', () => {
    // Said without reference to how evidence is decided: whatever the keys
    // under a claimed namespace are, if a line of source names every one of
    // them outright, the pattern that would have to build one at runtime is
    // still answered by nothing.
    fc.assert(
      fc.property(fc.uniqueArray(segmentArb, { minLength: 1, maxLength: 4 }), (segments) => {
        const ids = segments.map((segment) => `activation.goal.${segment}`)
        const findings = gradeCatalogues({
          scan: scanOf({
            assembled: [{ pattern: 'activation.goal.*', file: 'x.tsx', line: 1 }],
            references: ids.map((id) => ref(id, true)),
          }),
          catalogues: cataloguesOf(Object.fromEntries(ids.map((id) => [id, 'text']))),
          defaultLocale: 'en',
          exemptions: [],
          claimedPrefixes: ['activation.'],
        })
        return findings.some((f) => f.kind === 'unanswered-pattern' && f.id === 'activation.goal.*')
      })
    )
  })

  it('one key nothing else accounts for is enough to answer a pattern (I13)', () => {
    // The other direction, so the rule cannot pass by calling everything
    // unanswered. The segments are drawn as one unique set and then split, so
    // the free key differs from the named ones by construction rather than by
    // a filter over the generated cases.
    fc.assert(
      fc.property(fc.uniqueArray(segmentArb, { minLength: 2, maxLength: 5 }), (segments) => {
        const [free, ...named] = segments
        const namedIds = named.map((segment) => `activation.goal.${segment}`)
        const freeId = `activation.goal.${free}`
        const findings = gradeCatalogues({
          scan: scanOf({
            assembled: [{ pattern: 'activation.goal.*', file: 'x.tsx', line: 1 }],
            references: namedIds.map((id) => ref(id, true)),
          }),
          catalogues: cataloguesOf(
            Object.fromEntries([freeId, ...namedIds].map((id) => [id, 'text']))
          ),
          defaultLocale: 'en',
          exemptions: [],
          claimedPrefixes: ['activation.'],
        })
        return findings.every((f) => f.kind !== 'unanswered-pattern')
      })
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

// ============================================================================
// The second rule class: text written into the source instead of the catalogue
// ============================================================================

/** A file whose every shape the rules below have an opinion about. Built by a
 *  function rather than held at module scope: a mutant that crashes a fixture
 *  during collection is reported as survived, because the suite never runs. */
function editorLike(): string {
  return `
const slashItems = [
  {
    title: 'Bullet List',
    description: 'Unordered list',
    icon: <List className="size-4" />,
    command: 'bulletList',
  },
]

export function Toolbar({
  alt,
  organisation,
  placeholder = 'Write something...',
}: {
  alt: string
  organisation: string
  placeholder?: string
}) {
  return (
    <div className="flex items-center gap-2" role="toolbar" aria-label="Image options">
      <button title="Bold (Cmd+B)" onClick={() => editor.isActive('bold')}>
        Delete row
      </button>
      <img alt={alt} src="https://cdn.example.com/x.png" />
      <input placeholder="https://example.com" />
      <span>—</span>
      <span>2026</span>
      <em aria-label={\`\${organisation} Member\`}>{organisation}</em>
      <button onClick={applyLink} className={isActive ? 'border-primary' : 'border-muted'}>{isActive ? 'Update' : 'Add'}</button>
      <span title={isActive ? 'Linked' : 'Not linked yet'}>{organisation || 'Team'}</span>
      <span>{\`Signed in as \${organisation}\`}</span>
      <span>{formatCount('items left')}</span>
    </div>
  )
}
`
}

function scan(source: string, file = 'apps/web/src/components/ui/toolbar.tsx') {
  return scanDisplayText(file, source)
}

function reportedText(source: string): string[] {
  return scan(source)
    .strings.map((s) => s.text)
    .sort()
}

describe('text written into the source instead of the catalogue (I14, I15)', () => {
  it('names the file, the line and the word (I14)', () => {
    const found = scan(editorLike()).strings.find((s) => s.text === 'Delete row')

    expect(found).toBeDefined()
    expect(found?.file).toBe('apps/web/src/components/ui/toolbar.tsx')
    expect(found?.where).toBe('text')
    // The line of the word itself, not of the element that opens above it:
    // a report that points at the wrong line is a report nobody trusts.
    expect(editorLike().split('\n')[(found?.line ?? 0) - 1]).toContain('Delete row')
  })

  it('reads a tooltip, a screen-reader name, a placeholder and an image text (I15)', () => {
    const texts = reportedText(editorLike())

    expect(texts).toContain('Bold (Cmd+B)')
    expect(texts).toContain('Image options')
    expect(texts).toContain('https://example.com')
  })

  it('reads a word a display position chooses between (I15)', () => {
    // The reader sees the value, not the syntax. Both branches of a conditional
    // reach the screen, and so does the word behind an `||` -- which is the
    // shape that hid `'Team'` in `mention-picker.tsx` from the first version of
    // this rule.
    const texts = reportedText(editorLike())

    expect(texts).toContain('Update')
    expect(texts).toContain('Add')
    expect(texts).toContain('Team')
  })

  it('reads a chosen word in a readable attribute too, not only between tags (I15)', () => {
    // The same hole, on the other display position: a tooltip that picks
    // between two words we wrote is two tooltips we wrote.
    const texts = reportedText(editorLike())

    expect(texts).toContain('Linked')
    expect(texts).toContain('Not linked yet')
  })

  it('reads our half of a sentence assembled between tags (I15, I20)', () => {
    const texts = reportedText(editorLike())

    expect(texts).toContain('Signed in as')
  })

  it('stops at a call rather than reading what it was passed (I15)', () => {
    // A call in a display position is graded by the rule for calls, which knows
    // the short list of functions whose job is to show their argument. Reading
    // every other call's arguments here would report `formatMessage({ id })` --
    // the very thing this gate asks for -- as untranslated text.
    const texts = reportedText(editorLike())

    expect(texts).not.toContain('items left')
  })

  it('reads a display field in a table of items (I15)', () => {
    // A tooltip is a tooltip whether it is written `title=` in the markup or
    // `title:` in a row of a menu the markup renders. This is where two thirds
    // of this editor's words actually live -- its slash-command menu -- and the
    // first version of the rule saw none of them.
    const texts = reportedText(editorLike())

    expect(texts).toContain('Bullet List')
    expect(texts).toContain('Unordered list')
  })

  it('leaves alone the machine field beside it (I15)', () => {
    // Same object, one property along: the name of the command to run. Reading
    // it would put an editor node type in the catalogue.
    expect(reportedText(editorLike())).not.toContain('bulletList')
  })

  it('reads the word a display prop falls back to (I15)', () => {
    // A default is what most readers actually see, because most callers pass
    // nothing.
    expect(reportedText(editorLike())).toContain('Write something...')
  })

  it('leaves alone what only looks like language (I15)', () => {
    const texts = reportedText(editorLike())

    // A class list, a node type handed to the editor, and the address of an
    // asset. All English, none of it read by anyone.
    expect(texts).not.toContain('flex items-center gap-2')
    expect(texts).not.toContain('bold')
    expect(texts).not.toContain('https://cdn.example.com/x.png')
    expect(texts).not.toContain('toolbar')
    // A class name a conditional picks between. It reaches the same expression
    // shape a tooltip does, and an attribute nobody reads is still an attribute
    // nobody reads.
    expect(texts).not.toContain('border-primary')
    expect(texts).not.toContain('border-muted')
  })

  it('reads a sentence handed to something whose job is to show it (I15)', () => {
    const source = `
function f() {
  toast.error("Couldn't upload image. Try again.")
  const url = window.prompt('Paste YouTube video URL:')
  logger.warn('upload failed for asset')
  return url
}
`
    const texts = reportedText(source)

    expect(texts).toContain("Couldn't upload image. Try again.")
    expect(texts).toContain('Paste YouTube video URL:')
    // A log line is read by an operator in a log, not by a reader on a page.
    expect(texts).not.toContain('upload failed for asset')
  })
})

describe('what is not language (I19)', () => {
  it('passes over a separator, a number and whitespace (I19)', () => {
    const texts = reportedText(editorLike())

    expect(texts).not.toContain('—')
    expect(texts).not.toContain('2026')
    expect(texts.filter((t) => t.trim() === '')).toEqual([])
  })

  it('has something to report at all, so the check above is not vacuous (I19)', () => {
    expect(reportedText(editorLike()).length).toBeGreaterThan(3)
  })
})

describe('a person’s own words inside our sentence (I20)', () => {
  it('never asks for a value the source does not contain (I20)', () => {
    const texts = reportedText(editorLike())

    // `alt={alt}` is whatever the person typed when they uploaded, and
    // `{organisation}` is what they named their own workspace.
    expect(texts.some((t) => t.includes('organisation'))).toBe(false)
    expect(texts).not.toContain('alt')
  })

  it('holds the frame around those words, and only the frame (I20)', () => {
    const found = scan(editorLike()).strings.filter((s) => s.text.includes('Member'))

    expect(found).toHaveLength(1)
    expect(found[0].text.trim()).toBe('Member')
    expect(found[0].where).toBe('aria-label')
  })
})

describe('excusing a string that must not be translated (I17, I18)', () => {
  const withExcuse = `
export function X() {
  return (
    <div>
      {/* i18n-allow: the product's own name is the same in every language */}
      Quackback
      <input placeholder="https://example.com" /* i18n-allow: a specimen address is not language */ />
    </div>
  )
}
`

  it('honours a note at the line, in both forms (I17)', () => {
    const findings = gradeDisplayText([scan(withExcuse)])

    expect(findings.filter((f) => f.kind === 'untranslated-string')).toEqual([])
  })

  it('refuses a note with no reason rather than honouring it (I17)', () => {
    const source = withExcuse.replace(
      "i18n-allow: the product's own name is the same in every language",
      'i18n-allow'
    )

    const findings = gradeDisplayText([scan(source)])

    expect(findings.map((f) => f.kind)).toContain('excuse-without-reason')
    // And the string it tried to excuse is still reported, so a silenced
    // string cannot slip through on a malformed note.
    expect(findings.some((f) => f.kind === 'untranslated-string' && f.text === 'Quackback')).toBe(
      true
    )
  })

  it('reports a note that matches nothing as removable, without failing (I18)', () => {
    const source = `
export function X() {
  // i18n-allow: nothing here needs it any more
  return <div className="x" />
}
`
    const scanned = scan(source)

    expect(unusedExcuses([scanned])).toHaveLength(1)
    expect(gradeDisplayText([scanned])).toEqual([])
  })

  it('does not read a stray mention of the word as a note (I17)', () => {
    // The line below is text on a page, not an instruction to the gate.
    const source = `
export function X() {
  return <div title="Ask an admin about i18n-allow settings" />
}
`
    const findings = gradeDisplayText([scan(source)])

    expect(findings.some((f) => f.kind === 'untranslated-string')).toBe(true)
  })
})

describe('only the files handed in are graded (I16)', () => {
  it('grades nothing when nothing is handed in (I16)', () => {
    expect(gradeDisplayText([])).toEqual([])
    expect(unusedExcuses([])).toEqual([])
  })

  it('keeps each finding with the file it came from (I16)', () => {
    const findings = gradeDisplayText([
      scan(editorLike(), 'apps/web/src/components/ui/a.tsx'),
      scan(editorLike(), 'apps/web/src/components/ui/b.tsx'),
    ])

    expect(new Set(findings.map((f) => f.file))).toEqual(
      new Set(['apps/web/src/components/ui/a.tsx', 'apps/web/src/components/ui/b.tsx'])
    )
  })
})

describe('properties of the display-text rule', () => {
  it('never reports a class list, whatever it says (I15)', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z][a-z0-9 :/-]{0,40}$/), (classes) => {
        const source = `export const X = () => <div className=${JSON.stringify(classes)} />`

        expect(scan(source).strings).toEqual([])
      })
    )
  })

  it('never reports text with no word in it (I19)', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[-—·:;.,!?()[\]{}0-9\s]{1,30}$/).filter((s) => !s.includes('}')),
        (noise) => {
          const source = `export const X = () => <div>${noise}</div>`

          expect(scan(source).strings).toEqual([])
        }
      )
    )
  })

  it('excusing a line removes that string and leaves the others (I17)', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z][a-z]{2,10}( [a-z]{2,10}){0,3}$/),
        fc.stringMatching(/^[a-z][a-z ]{5,40}$/),
        (word, reason) => {
          const bare = `export const X = () => (
  <div>
    <span title=${JSON.stringify(word)} />
    <span title="Kept as it was" />
  </div>
)`
          const excused = `export const X = () => (
  <div>
    <span title=${JSON.stringify(word)} /* i18n-allow: ${reason} */ />
    <span title="Kept as it was" />
  </div>
)`

          expect(
            gradeDisplayText([scan(bare)])
              .map((f) => f.text)
              .sort()
          ).toEqual([word, 'Kept as it was'].sort())
          expect(gradeDisplayText([scan(excused)]).map((f) => f.text)).toEqual(['Kept as it was'])
        }
      )
    )
  })
})
