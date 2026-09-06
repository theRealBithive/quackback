/**
 * The i18n gate's policy, separated from the process it runs in.
 *
 * The guarantees are numbered in `__tests__/i18n-policy.test.ts`. Nothing in
 * here reads a file, walks a directory or exits — `i18n-check.ts` does that and
 * hands the contents in, so every branch below is reachable from a test. That
 * split is the shape the audit and mutation gates already have, and it exists
 * for the same reason: the part that talks to the filesystem is the part no
 * in-process coverage provider can see.
 *
 * Why an AST and not a regular expression: the question this gate asks is
 * always about *position*. `id="x"` on a `<div>` is not a message, `id: 'x'` in
 * a data row is not a message, and the same word in a comment is neither. A
 * pattern over text cannot tell those apart, and a gate that reports them is a
 * gate that gets switched off.
 */
import { parseSync } from 'oxc-parser'

/** The component that renders a translated message. */
const MESSAGE_ELEMENT = 'FormattedMessage'

/** The call that formats one imperatively. */
const MESSAGE_CALL = 'formatMessage'

/** The attribute or property that carries the English original. */
const ENGLISH_ORIGINAL = 'defaultMessage'

/** Directories under the source root that hold no shipping source. */
const NOT_SHIPPED_DIRECTORIES = new Set(['locales', '__tests__'])

/** Generated, and large enough to dominate a scan for nothing. */
const GENERATED_FILES = new Set(['routeTree.gen.ts'])

/**
 * Whether a path inside the source tree is source the product ships.
 *
 * The subtle case is the second one. Routes in this repository are named
 * flatly, with dots for path segments — `automation.connectors_.$connectorId.tsx`
 * — so the page at `/admin/automation/test` is a file called
 * `automation.test.tsx`. A rule that skips everything matching `*.test.tsx`
 * would skip that page and then report every message on it as a key nothing
 * reaches. Suites live in `__tests__` directories or outside `routes`, and that
 * is the distinction drawn here.
 */
export function isShippedSource(relativePath: string): boolean {
  const segments = relativePath.split('/')
  const name = segments[segments.length - 1]
  if (!name.endsWith('.ts') && !name.endsWith('.tsx')) return false
  if (GENERATED_FILES.has(name)) return false
  if (segments.some((segment) => NOT_SHIPPED_DIRECTORIES.has(segment))) return false
  const isRoute = segments[0] === 'routes'
  if (!isRoute && (name.endsWith('.test.ts') || name.endsWith('.test.tsx'))) return false
  return true
}

/** One place in the source that names a message id. */
export interface IdReference {
  id: string
  file: string
  line: number
  /** Whether the English original travels with the reference (`defaultMessage`). */
  carriesEnglish: boolean
}

/** An id the product assembles at runtime, e.g. `activation.goal.${outcome}`. */
export interface AssembledId {
  /** The literal with each `${...}` replaced by `*`. */
  pattern: string
  file: string
  line: number
}

/** What a scan of the source says about message ids. */
export interface SourceScan {
  references: IdReference[]
  assembled: AssembledId[]
  /** Every string literal seen, so a key named indirectly still counts. */
  literals: string[]
}

export type FindingKind =
  | 'missing-from-catalogue'
  | 'unreferenced-key'
  | 'empty-without-english'
  | 'blank-translation'
  | 'unanswered-pattern'

export interface Finding {
  kind: FindingKind
  id: string
  file?: string
  line?: number
  detail: string
}

export interface Exemption {
  id: string
  reason: string
}

export interface CatalogueInput {
  scan: SourceScan
  catalogues: Record<string, Record<string, string>>
  defaultLocale: string
  exemptions: Exemption[]
  /**
   * The message namespaces we claim to have translated, as id prefixes. An
   * entry is an assertion: every id the interface builds at runtime under this
   * prefix resolves to something. Claiming one turns {@link unclaimedPatterns}
   * reporting into a failing finding, so the list can only ever make the gate
   * louder -- and it is asserted in full by `__tests__/i18n-scope.test.ts`, so
   * it cannot shrink without a red test saying so.
   */
  claimedPrefixes: readonly string[]
}

/** Byte offset -> 1-based line number. */
function lineIndex(text: string): (offset: number) => number {
  return (offset: number) => text.slice(0, offset).split('\n').length
}

/** The string a node holds, or null when it is not a plain string literal. */
function stringOf(node: unknown): string | null {
  const n = node as { type?: string; value?: unknown }
  if (n?.type !== 'Literal') return null
  return typeof n.value === 'string' ? n.value : null
}

/**
 * A template literal as a pattern, each `${...}` written as `*`.
 *
 * Returns null when the literal holds no dot: a message id is dotted by
 * convention throughout this repository, and the same syntax builds DOM ids
 * (`connector-available-${agent}`) and edge keys, which are not messages.
 */
function patternOf(node: unknown): string | null {
  const n = node as { type?: string; quasis: { value: { raw: string } }[] }
  if (n?.type !== 'TemplateLiteral') return null
  const pattern = n.quasis.map((q) => q.value.raw).join('*')
  return pattern.includes('.') ? pattern : null
}

function attributeNamed(attributes: unknown[], name: string) {
  return attributes.find((a) => {
    const attr = a as { type?: string; name?: { name?: string } }
    return attr?.type === 'JSXAttribute' && attr.name?.name === name
  }) as { value?: unknown } | undefined
}

/** Unwrap `{ ... }` around a JSX attribute value. */
function attributeValue(attribute: { value?: unknown } | undefined): unknown {
  const value = attribute?.value as { type?: string; expression?: unknown } | undefined
  if (value?.type === 'JSXExpressionContainer') return value.expression
  return value
}

function propertyNamed(properties: unknown[], name: string) {
  return properties.find((p) => {
    const prop = p as { type?: string; key?: { name?: string; value?: unknown } }
    if (prop?.type !== 'Property') return false
    return prop.key?.name === name || prop.key?.value === name
  }) as { value?: unknown } | undefined
}

/**
 * Read every message id out of one source file.
 *
 * Three things are collected, because a key can be reached in three ways and a
 * gate that knows only the first reports the other two as dead:
 * a message written out in full, an id assembled from a fixed prefix, and an id
 * held in a table and passed on by name.
 */
export function scanSource(file: string, text: string): SourceScan {
  const parsed = parseSync(file, text)
  const lineOf = lineIndex(text)
  const references: IdReference[] = []
  const assembled: AssembledId[] = []
  const literals: string[] = []
  /** Objects that are an argument of `formatMessage(...)`, so their `id` is one. */
  const messageDescriptors = new Set<unknown>()

  const record = (
    id: string | null,
    pattern: string | null,
    offset: number,
    carriesEnglish: boolean
  ) => {
    if (id !== null) references.push({ id, file, line: lineOf(offset), carriesEnglish })
    else if (pattern !== null) assembled.push({ pattern, file, line: lineOf(offset) })
  }

  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as Record<string, unknown> & { type?: string; start?: number }

    switch (n.type) {
      case 'Literal': {
        // Every string, so a key named indirectly still counts as reached.
        if (typeof n.value === 'string') literals.push(n.value)
        break
      }
      case 'CallExpression': {
        // The arguments of `formatMessage(...)` are message descriptors, so an
        // `id` inside one is a message even with no English original beside it.
        // Non-object arguments are added too and simply never looked up again.
        const callee = n.callee as { type?: string; name?: string; property?: { name?: string } }
        const called = callee.type === 'Identifier' ? callee.name : callee.property?.name
        if (called === MESSAGE_CALL) {
          for (const argument of n.arguments as unknown[]) messageDescriptors.add(argument)
        }
        break
      }
      case 'JSXOpeningElement': {
        // The element name is a plain identifier; a namespaced
        // `<Chart.FormattedMessage>` is a node, never the string, so it does
        // not match and nothing in this repository writes one.
        if ((n.name as { name?: unknown }).name !== MESSAGE_ELEMENT) break
        const attributes = n.attributes as unknown[]
        const idValue = attributeValue(attributeNamed(attributes, 'id'))
        const carriesEnglish = attributeNamed(attributes, ENGLISH_ORIGINAL) !== undefined
        record(stringOf(idValue), patternOf(idValue), n.start ?? 0, carriesEnglish)
        break
      }
      case 'ObjectExpression': {
        const properties = n.properties as unknown[]
        const english = propertyNamed(properties, ENGLISH_ORIGINAL)
        // An `id` alone is not a message: data rows have ids too. It counts
        // when the English original sits beside it, or when the object is
        // handed to `formatMessage`.
        if (english !== undefined || messageDescriptors.has(node)) {
          const idValue = propertyNamed(properties, 'id')?.value
          record(stringOf(idValue), patternOf(idValue), n.start ?? 0, english !== undefined)
        }
        break
      }
    }

    // Every value, including `type`, `start` and `end`, and the elements of an
    // array: visiting a string or a number returns immediately, so a guard
    // against them would be an optimisation with its own branches to get wrong.
    for (const value of Object.values(n)) visit(value)
  }

  visit(parsed.program)
  return { references, assembled, literals }
}

/** Fold the scans of many files into the one picture the rules are graded on. */
export function mergeScans(scans: SourceScan[]): SourceScan {
  const references: IdReference[] = []
  const assembled: AssembledId[] = []
  const literals = new Set<string>()
  for (const scan of scans) {
    references.push(...scan.references)
    assembled.push(...scan.assembled)
    for (const literal of scan.literals) literals.add(literal)
  }
  return { references, assembled, literals: [...literals] }
}

/** Whether an assembled pattern can produce this id. */
function matchesPattern(id: string, pattern: string): boolean {
  const parts = pattern.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`^${parts.join('[A-Za-z0-9_.:-]+')}$`).test(id)
}

/** Whether any key in the catalogue can satisfy an assembled pattern. */
function patternIsAnswered(catalogue: Record<string, string>, pattern: string): boolean {
  return Object.keys(catalogue).some((id) => matchesPattern(id, pattern))
}

/** The runtime-built ids the gate reports on rather than fails for: nothing in
 *  the catalogue can satisfy them, and we have not claimed their namespace. */
export function unclaimedPatterns(input: CatalogueInput): AssembledId[] {
  const catalogue = input.catalogues[input.defaultLocale] ?? {}
  return input.scan.assembled.filter(
    (assembled) =>
      !patternIsAnswered(catalogue, assembled.pattern) &&
      !input.claimedPrefixes.some((prefix) => assembled.pattern.startsWith(prefix))
  )
}

/** The languages whose entry for an id is missing or reads as nothing. */
function blankLocales(catalogues: Record<string, Record<string, string>>, id: string): string[] {
  return Object.keys(catalogues)
    .filter((locale) => (catalogues[locale][id] ?? '').trim() === '')
    .sort()
}

function assertReasons(exemptions: Exemption[]): void {
  for (const exemption of exemptions) {
    if (exemption.reason.trim() === '') {
      throw new Error(
        `i18n exemption for "${exemption.id}" has no reason. An exemption without a reason is an allowlist entry; say why no translation can exist for it.`
      )
    }
  }
}

/** The exemptions that no longer excuse anything, so the list cannot rot. */
export function unusedExemptions(input: CatalogueInput): Exemption[] {
  assertReasons(input.exemptions)
  const blocking = new Set(gradeIgnoringExemptions(input).map((f) => f.id))
  return input.exemptions.filter((e) => !blocking.has(e.id))
}

function gradeIgnoringExemptions(input: CatalogueInput): Finding[] {
  const { scan, catalogues, defaultLocale } = input
  const defaultCatalogue = catalogues[defaultLocale] ?? {}
  const findings: Finding[] = []

  const firstReference = new Map<string, IdReference>()
  for (const reference of scan.references) {
    if (!firstReference.has(reference.id)) firstReference.set(reference.id, reference)
  }

  // I1 — shown by the interface, defined by no catalogue.
  for (const [id, reference] of firstReference) {
    if (id in defaultCatalogue) continue
    findings.push({
      kind: 'missing-from-catalogue',
      id,
      file: reference.file,
      line: reference.line,
      detail: `no entry in ${defaultLocale}.json, so it renders English in every language`,
    })
  }

  // I11 — built at runtime in a namespace we claim, and answered by nothing.
  // I1 cannot see this: no line of source spells such an id out, so there is
  // nothing to look up, and I4 reads the pattern itself as proof of use.
  for (const assembled of scan.assembled) {
    if (!input.claimedPrefixes.some((prefix) => assembled.pattern.startsWith(prefix))) continue
    if (patternIsAnswered(defaultCatalogue, assembled.pattern)) continue
    findings.push({
      kind: 'unanswered-pattern',
      id: assembled.pattern,
      file: assembled.file,
      line: assembled.line,
      detail: `no ${defaultLocale}.json key can satisfy it, so every id built here renders English`,
    })
  }

  const named = new Set(scan.literals)
  const reached = (id: string) =>
    firstReference.has(id) ||
    named.has(id) ||
    scan.assembled.some((a) => matchesPattern(id, a.pattern))

  // I2 — carried by the catalogue, reachable by nothing.
  for (const id of Object.keys(defaultCatalogue)) {
    if (reached(id)) continue
    findings.push({
      kind: 'unreferenced-key',
      id,
      detail: `no source reference, so it is translated into every language and shown to nobody`,
    })
  }

  // I3 — reached without an English original, and blank somewhere.
  for (const id of Object.keys(defaultCatalogue)) {
    if (!reached(id)) continue
    if (firstReference.get(id)?.carriesEnglish) continue
    const blankIn = blankLocales(catalogues, id)
    if (blankIn.length === 0) continue
    const reference = firstReference.get(id)
    findings.push({
      kind: 'empty-without-english',
      id,
      file: reference?.file,
      line: reference?.line,
      detail: `blank in ${blankIn.join(', ')} and used without ${ENGLISH_ORIGINAL}, so those readers see the id itself`,
    })
  }

  // I10 — reached, blank, and with an English original to fall back on. Less
  // severe than the case above and still not a translation: the reader is
  // shown English rather than the language they chose.
  for (const id of Object.keys(defaultCatalogue)) {
    // A reference carrying the English original is itself proof the id is
    // reached, so there is no separate reachability check here.
    const reference = firstReference.get(id)
    if (!reference?.carriesEnglish) continue
    const blankIn = blankLocales(catalogues, id)
    if (blankIn.length === 0) continue
    findings.push({
      kind: 'blank-translation',
      id,
      file: reference.file,
      line: reference.line,
      detail: `blank in ${blankIn.join(', ')}, so those readers see the English original instead of their own language`,
    })
  }

  return findings
}

/**
 * Grade the catalogues against what the source can reach.
 *
 * Everything returned fails the run. An exemption that matches nothing is not
 * a finding — it is reported separately by {@link unusedExemptions}, because a
 * stale exemption is untidiness and a missing translation is a defect.
 */
export function gradeCatalogues(input: CatalogueInput): Finding[] {
  assertReasons(input.exemptions)
  const excused = new Set(input.exemptions.map((e) => e.id))
  return gradeIgnoringExemptions(input).filter((finding) => !excused.has(finding.id))
}
