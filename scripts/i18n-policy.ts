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

// ============================================================================
// The second rule class: text written into the source instead of the catalogue
// ============================================================================

/**
 * The attributes a person actually reads.
 *
 * Deliberately short. Every name added here is a name the rule will read on
 * every element in every checked file, and the cost of getting one wrong is
 * not a missed string -- it is a report full of class lists and node types,
 * which is how a gate stops being read.
 */
const READABLE_ATTRIBUTES = new Set([
  'title',
  'aria-label',
  'placeholder',
  'alt',
  'label',
  'description',
])

/** Objects whose every method exists to show the string handed to it. */
const SHOWING_OBJECTS = new Set(['toast'])

/** Functions of the same kind, called with or without `window.`. */
const SHOWING_FUNCTIONS = new Set(['prompt', 'confirm', 'alert'])

/** The marker that excuses a line, and the reason it demands. */
const EXCUSE = /^\s*i18n-allow\b\s*:?\s*(.*)$/s

/** Whether a string holds a word, in any script. A separator, a number and a
 *  bare symbol are not language, and a rule that reports them teaches people
 *  to switch it off (I19). */
function holdsAWord(text: string): boolean {
  return /\p{L}/u.test(text)
}

export interface DisplayString {
  /** The text as a reader would see it, trimmed. */
  text: string
  file: string
  line: number
  /** Where it sat: `text` between tags, an attribute name, or the call it was
   *  handed to. The rule is about position, so the report says the position. */
  where: string
}

export interface DisplayExcuse {
  file: string
  line: number
  /** Empty when the note gave none, which is refused rather than honoured. */
  reason: string
  /** Whether the note stood alone on its line, which decides how far it
   *  reaches. See {@link standsAlone}. */
  ownLine: boolean
}

export interface DisplayScan {
  strings: DisplayString[]
  excuses: DisplayExcuse[]
}

export interface DisplayFinding {
  kind: 'untranslated-string' | 'excuse-without-reason'
  text: string
  file: string
  line: number
  where: string
  detail: string
}

/**
 * Whether a note stood alone on its line.
 *
 * This decides how far it reaches, and the two forms are not interchangeable.
 * Inside JSX the only comment syntax is `{/* ... *\/}`, which cannot sit after
 * the text it speaks for -- a `//` line among JSX children is text on the page,
 * not a comment (measured; the parser reports it as part of the text node). So
 * a note alone on its line speaks for the line below it. A note *after* a word
 * speaks for that word only: letting the trailing form reach further silences
 * the next string as well, which is a hole it would open on every single use.
 * A property test found that, having been written before the rule was.
 */
function standsAlone(text: string, start: number, end: number): boolean {
  const before = text.slice(text.lastIndexOf('\n', start - 1) + 1, start)
  const lineEnd = text.indexOf('\n', end)
  const after = text.slice(end, lineEnd < 0 ? text.length : lineEnd)
  return /^[\s{]*$/.test(before) && /^[\s}]*$/.test(after)
}

/** What a call is written as, as far as the two rules below care: a bare name,
 *  or a name on something. A callee is always one of the parser's nodes, so
 *  there is no guard for a missing one -- it would be a branch no source can
 *  take. */
type Callee = {
  type: string
  name: string
  object: { name?: string }
  property: { name?: string }
}

/**
 * The name a call is made under, for the report.
 *
 * Reached only for a callee {@link showsItsArgument} accepted, so the type is
 * one of the two below. `null` is for the shape that has no name to print: a
 * method reached by a computed key, where the report says `call` instead.
 */
function calleeName(callee: unknown): string | null {
  const c = callee as Callee
  if (c.type === 'Identifier') return c.name
  const object = c.object.name
  const property = c.property.name
  if (!property) return null
  return object ? `${object}.${property}` : property
}

/** Whether a call's string arguments are shown to a reader. */
function showsItsArgument(callee: unknown): boolean {
  const c = callee as Callee
  if (c.type === 'Identifier') return SHOWING_FUNCTIONS.has(c.name)
  if (c.type !== 'MemberExpression') return false
  if (SHOWING_OBJECTS.has(c.object.name ?? '')) return true
  return SHOWING_FUNCTIONS.has(c.property.name ?? '')
}

/**
 * Read every word a reader can see out of one source file, and every note
 * excusing one.
 *
 * The whole rule is about *position*: the same word is a label in one place, a
 * class name in another and a node type in a third. So nothing here looks at
 * what a string says -- only at where it sits, and whether it holds a word at
 * all (I15, I19).
 *
 * A person's own words never appear, and not by a special case: they reach the
 * page through an expression, and an expression is not a literal. Where our
 * sentence carries their words inside it -- a template literal -- the pieces
 * we wrote are read and the holes are not (I20).
 */
/**
 * The name a property or a binding carries, when it is written out rather than
 * computed. A computed key is a name we cannot read, so it is not one of the
 * few we grade.
 */
function writtenName(node: unknown): string | null {
  // Both callers hand in a key or a binding that exists, so there is no guard
  // for a missing one: it would be a branch no input can take.
  const n = node as { type?: string; name?: string; value?: unknown }
  if (n.type === 'Identifier') return n.name ?? null
  return stringOf(n)
}

/**
 * The words a display position would actually render, out of the expression
 * sitting in it.
 *
 * A reader sees the value, not the syntax: `{isActive ? 'Update' : 'Add'}`
 * shows one of two words we wrote, and `title={busy ? 'Saving' : 'Save'}` is a
 * tooltip either way. So the descent follows the shapes whose words are the
 * words in their parts -- a conditional, an `||`/`??`/`&&` chain, and a `+`
 * that joins one part to another -- and reads the pieces of our own sentence
 * out of a template literal, leaving the holes for a person's own words alone
 * (I20).
 *
 * Both sides of a logical chain are read rather than only the one that can be
 * rendered: a string literal on the left of `&&` or `??` is dead either way,
 * and an operator table there would be a second thing to keep true for no
 * finding it could add. A binary operator is a different matter, and `+` is
 * the only one of them that gets read: it is the one whose result is its parts
 * put together, exactly as a template literal is. Every other binary operator
 * answers a question about a value rather than showing it, and reading
 * `position === 'top'` would report the name of a setting as a sentence.
 *
 * It stops at a call. A call in a display position is graded by the rule for
 * calls, which knows the short list of functions whose whole job is to show
 * their argument -- and every other call there is as likely to be
 * `formatMessage({ id })`, whose argument is an id rather than a word. Reading
 * those would report the very thing this gate asks for.
 */
function displayValues(expression: unknown): { text: string; start: number }[] {
  // Every caller hands in one of the parser's nodes or nothing at all -- an
  // attribute with no value, a branch a shape does not have. So the guard is
  // for the nothing; a check that the something is an object would be a branch
  // no call site can take.
  if (!expression) return []
  const node = expression as Record<string, unknown> & { type?: string; start?: number }

  const literal = stringOf(node)
  if (literal !== null) return [{ text: literal, start: node.start ?? 0 }]

  if (node.type === 'TemplateLiteral') {
    // Every piece of a template literal is a node of its own and carries its
    // own position, so there is no fallback here: it would be a branch no
    // source can take.
    const quasis = node.quasis as { value: { raw: string }; start: number }[]
    return quasis.map((quasi) => ({ text: quasi.value.raw, start: quasi.start }))
  }

  if (node.type === 'ConditionalExpression') {
    return [...displayValues(node.consequent), ...displayValues(node.alternate)]
  }

  if (node.type === 'LogicalExpression') {
    return [...displayValues(node.left), ...displayValues(node.right)]
  }

  if (node.type === 'BinaryExpression') {
    // Two conditions and not one `&&`, because a record in the mutation
    // manifest is addressed by the text of its line: the joined form put three
    // mutants on one line that the manifest cannot tell apart, so excusing the
    // one that no test can catch would have excused the two that tests do.
    if (node.operator !== '+') return []
    return [...displayValues(node.left), ...displayValues(node.right)]
  }

  return []
}

export function scanDisplayText(file: string, text: string): DisplayScan {
  const parsed = parseSync(file, text)
  const lineOf = lineIndex(text)
  const strings: DisplayString[] = []

  /** The line the word itself sits on, not the line the node opens on. A
   *  report that points at the element above the text is a report nobody
   *  trusts, and JSX text starts at the previous tag. */
  const lineOfWord = (raw: string, start: number): number =>
    // `record` below only reaches here for a string that holds a word, so the
    // search always finds one; a fallback for -1 would be a branch no input
    // can take.
    lineOf(start + raw.search(/\p{L}/u))

  const record = (raw: string, start: number, where: string) => {
    if (!holdsAWord(raw)) return
    strings.push({ text: raw.trim(), file, line: lineOfWord(raw, start), where })
  }

  /** Containers an attribute already answered for; see the attribute case. An
   *  attribute is always visited before the container inside it, because each
   *  node is graded before the walk descends into it. */
  const gradedAsAttribute = new Set<unknown>()

  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as Record<string, unknown> & { type?: string; start?: number }

    switch (n.type) {
      case 'JSXText': {
        // A text node is the string it holds, so neither a conversion nor a
        // fallback here can be reached.
        record(n.value as string, n.start as number, 'text')
        break
      }
      case 'JSXAttribute': {
        // Claimed before the allowlist is consulted, not after. The walk below
        // reaches this attribute's own container too, and the case for a
        // container has no way to ask what it is sitting in -- so an attribute
        // that is *not* a display position has to claim its container as well,
        // or `className={busy ? 'a' : 'b'}` would be read as text on the page.
        const container = (n as { value?: unknown }).value
        // Claimed whatever the value turns out to be. Only a container is ever
        // looked up again, so a quoted value or a valueless attribute lands in
        // here and is never asked for -- and a test for the difference would be
        // a test of the set rather than of the report.
        gradedAsAttribute.add(container)
        const name = (n.name as { name?: string }).name
        if (!name || !READABLE_ATTRIBUTES.has(name)) break
        for (const word of displayValues(attributeValue(n as { value?: unknown }))) {
          record(word.text, word.start, name)
        }
        break
      }
      case 'JSXExpressionContainer': {
        // Between the tags rather than in an attribute: a word in braces is a
        // word on the page.
        if (gradedAsAttribute.has(node)) break
        for (const word of displayValues(n.expression)) record(word.text, word.start, 'text')
        break
      }
      case 'Property': {
        // A tooltip is a tooltip whether it is written `title=` in the markup
        // or `title:` in a row of a menu the markup renders from a table. The
        // same short list of names decides, for the same reason: the name says
        // a person reads the value, and the property beside it holding a node
        // type or a command says nobody does.
        //
        // `computed` sits on the property rather than on its key, which is
        // where this check used to be and therefore never fired: `{[title]: x}`
        // is a name decided at runtime that reads exactly like `title:` in the
        // source, and grading it would report a word by the name of a variable
        // instead of by where it sits.
        if (n.computed) break
        const key = writtenName((n as { key?: unknown }).key)
        if (!key || !READABLE_ATTRIBUTES.has(key)) break
        for (const word of displayValues((n as { value?: unknown }).value)) {
          record(word.text, word.start, key)
        }
        break
      }
      case 'AssignmentPattern': {
        // The word a display prop falls back to. It is what most readers
        // actually see, because most callers pass nothing.
        const bound = writtenName((n as { left?: unknown }).left)
        if (!bound || !READABLE_ATTRIBUTES.has(bound)) break
        for (const word of displayValues((n as { right?: unknown }).right)) {
          record(word.text, word.start, bound)
        }
        break
      }
      case 'CallExpression': {
        if (!showsItsArgument(n.callee)) break
        const where = calleeName(n.callee) ?? 'call'
        for (const argument of n.arguments as unknown[]) {
          const literal = stringOf(argument)
          if (literal !== null) record(literal, (argument as { start: number }).start, where)
        }
        break
      }
    }

    for (const value of Object.values(n)) visit(value)
  }

  visit(parsed.program)

  const comments = (parsed as { comments: { value: string; start: number; end: number }[] })
    .comments
  const excuses: DisplayExcuse[] = []
  for (const comment of comments) {
    const matched = EXCUSE.exec(comment.value)
    if (!matched) continue
    excuses.push({
      file,
      // The line the note *finishes* on. A reason worth writing rarely fits on
      // one line, and anchoring on the line it opens on would excuse a line
      // still inside the note -- so a real reason would read as a broken excuse
      // while a short, reasonless one worked. For a note that does fit on one
      // line, and for the trailing form, start and end are the same line.
      line: lineOf(comment.end),
      reason: matched[1].trim(),
      ownLine: standsAlone(text, comment.start, comment.end),
    })
  }

  return { strings, excuses }
}

/**
 * Whether a note speaks for a given word: on its line always, and on the line
 * below only when the note stood alone (see {@link standsAlone}).
 *
 * Both callers pair a scan's notes with the same scan's words, and a scan is
 * one file, so the two are always in the same file. There is no check for it
 * here: it would be a branch no input can take.
 */
function excuses(excuse: DisplayExcuse, string: DisplayString): boolean {
  if (excuse.line === string.line) return true
  return excuse.ownLine && excuse.line === string.line - 1
}

/** The notes that carry a reason, which are the only ones that silence
 *  anything: a note without one is refused (I17). */
function reasonedExcuses(scan: DisplayScan): DisplayExcuse[] {
  return scan.excuses.filter((excuse) => excuse.reason !== '')
}

/**
 * Grade the text found in the checked files.
 *
 * Only the files handed in are graded, and each finding keeps the file it came
 * from: the manifest decides what is checked, not this function (I16).
 */
export function gradeDisplayText(scans: readonly DisplayScan[]): DisplayFinding[] {
  const findings: DisplayFinding[] = []
  for (const scan of scans) {
    const silencing = reasonedExcuses(scan)
    for (const string of scan.strings) {
      if (silencing.some((excuse) => excuses(excuse, string))) continue
      findings.push({
        kind: 'untranslated-string',
        text: string.text,
        file: string.file,
        line: string.line,
        where: string.where,
        detail:
          `read by a person as ${string.where === 'text' ? 'text on the page' : `the ${string.where}`}` +
          ', so it belongs in the catalogue rather than in the source',
      })
    }
    for (const excuse of scan.excuses) {
      if (excuse.reason !== '') continue
      findings.push({
        kind: 'excuse-without-reason',
        text: '',
        file: excuse.file,
        line: excuse.line,
        where: 'note',
        detail:
          'an excuse with no reason is an allowlist entry, so it is refused rather than honoured',
      })
    }
  }
  return findings
}

/** The notes that no longer speak for anything. Reported and not fatal, so the
 *  list cannot rot into stale claims without anyone seeing it (I18). */
export function unusedExcuses(scans: readonly DisplayScan[]): DisplayExcuse[] {
  const stale: DisplayExcuse[] = []
  for (const scan of scans) {
    for (const excuse of reasonedExcuses(scan)) {
      if (!scan.strings.some((string) => excuses(excuse, string))) stale.push(excuse)
    }
  }
  return stale
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

/** The keys the source names outright, by an `id` or as a bare literal. */
function namedIds(scan: SourceScan): Set<string> {
  const named = new Set(scan.literals)
  for (const reference of scan.references) named.add(reference.id)
  return named
}

/** Whether something more specific than `pattern` already accounts for `id`:
 *  a line naming it outright, or a pattern that leaves less to be filled in. */
function accountedForElsewhere(
  id: string,
  pattern: string,
  scan: SourceScan,
  named: Set<string>
): boolean {
  if (named.has(id)) return true
  // Fewer wildcards means less is filled in at runtime, so that pattern is the
  // more specific account. Splitting on the wildcard counts the pieces around
  // them, which is one more than the wildcards and orders the patterns alike.
  const pieces = pattern.split('*').length
  return scan.assembled.some(
    (other) => other.pattern.split('*').length < pieces && matchesPattern(id, other.pattern)
  )
}

/** Whether any key in the catalogue is evidence that a pattern resolves. A key
 *  something more specific already accounts for is not (I13): otherwise a
 *  namespace reads as answered because of its neighbours. */
function patternIsAnswered(
  catalogue: Record<string, string>,
  pattern: string,
  scan: SourceScan,
  named: Set<string>
): boolean {
  return Object.keys(catalogue).some(
    (id) => matchesPattern(id, pattern) && !accountedForElsewhere(id, pattern, scan, named)
  )
}

/** The runtime-built ids the gate reports on rather than fails for: nothing in
 *  the catalogue can satisfy them, and we have not claimed their namespace. */
export function unclaimedPatterns(input: CatalogueInput): AssembledId[] {
  const catalogue = input.catalogues[input.defaultLocale] ?? {}
  const named = namedIds(input.scan)
  return input.scan.assembled.filter(
    (assembled) =>
      !patternIsAnswered(catalogue, assembled.pattern, input.scan, named) &&
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
  const namedInSource = namedIds(scan)
  for (const assembled of scan.assembled) {
    if (!input.claimedPrefixes.some((prefix) => assembled.pattern.startsWith(prefix))) continue
    if (patternIsAnswered(defaultCatalogue, assembled.pattern, scan, namedInSource)) continue
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
