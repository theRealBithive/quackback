/**
 * The infrastructure gate on the real-DB fixture: a suite that skipped because
 * its database was missing must not be able to read as a pass.
 *
 * Confirmed contract:
 *
 *   V1  A run that skipped a suite because its infrastructure was missing is
 *       not a passing run, whenever the run was declared complete.
 *   V2  "Declared complete" is explicit, never inferred. CI declares it; a
 *       laptop does not — so a local run without Postgres still skips and
 *       still reads green.
 *   V3  A skip for a reason unrelated to infrastructure (a deliberate
 *       `it.skip` on known-broken behaviour) is untouched by this gate.
 *   V4  A stale schema counts as missing infrastructure, not as available: a
 *       failed schema probe is exactly as loud as a refused connection.
 *   V5  The reason the database was unusable is never swallowed — whatever the
 *       failure was appears in the output.
 *   V6  When the gate fails, the message names which infrastructure was
 *       missing and how to supply it, not merely that something was skipped.
 *   V7  Tests never silently fall back to a database other than the one they
 *       were told to use.
 *
 * Added while implementing, for review rather than from the confirmed list:
 *
 *   V8  The message never reveals the database password. The URL it names
 *       carries credentials, and the message is printed into CI logs.
 *   V9  The gate's own tests are subject to the gate: on a run declared
 *       complete, the files that check V3, V4 and V5 cannot skip for want of a
 *       database, because `vitest.global-setup.ts` fails the run before any
 *       file loads. Otherwise the guarantees about silent skips would
 *       themselves be verified by a silent skip.
 *
 * V8 is stated as non-interference — changing only the password never changes
 * the message — rather than as "the output lacks this substring". A generated
 * password like `5432` or `postgres` occurs in the URL for honest reasons, so
 * the substring form would produce spurious counterexamples; the
 * non-interference form also proves the password is never read at all.
 *
 * The generated password is percent-encoded into the URL, because that is what
 * a password in a URL is: a raw `@` or `/` would change where the userinfo
 * section ends, so such a case varies the URL's structure and not only its
 * password — a different premise than the one V8 states.
 *
 * V1, V3 and V4 need a fixture and therefore a file of their own (the fixture
 * is module-global, one per file): see `db-fixture-infra-gate-throws.test.ts`,
 * `db-fixture-infra-gate-inert.db.test.ts` and
 * `db-fixture-infra-gate-probe.db.test.ts`. V2 is checked end to end in
 * `db-fixture-infra-gate-skips.test.ts`, and V9 is enforced centrally by
 * `vitest.global-setup.ts`, which also extends V1 and V4 to the 25 suites that
 * open their own connection instead of using the fixture.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  isTestDatabaseRequired,
  schemaStaleness,
  testDatabaseUrls,
  unavailableMessage,
  DEV_DATABASE_URL,
} from './db-test-fixture'

/** The four spellings that mean "this run may skip", per V2. */
const OFF_VALUES = ['', '0', 'false', 'no']

const urlWithPassword = (password: string): string =>
  `postgresql://postgres:${encodeURIComponent(password)}@localhost:5432/quackback_test`

describe('isTestDatabaseRequired (V2)', () => {
  it('an unset variable leaves the run free to skip', () => {
    expect(isTestDatabaseRequired({})).toBe(false)
  })

  it('the documented on-value declares the run complete', () => {
    expect(isTestDatabaseRequired({ REQUIRE_TEST_DB: '1' })).toBe(true)
  })

  it('CI alone never declares a run complete — the choice stays explicit', () => {
    expect(isTestDatabaseRequired({ CI: 'true' })).toBe(false)
  })

  it.each(OFF_VALUES)('%o means the run may skip', (value) => {
    expect(isTestDatabaseRequired({ REQUIRE_TEST_DB: value })).toBe(false)
  })

  it('an off-value is recognised whatever its casing or padding', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...OFF_VALUES),
        fc.constantFrom('', ' ', '\t', '  '),
        fc.boolean(),
        (value, padding, upper) => {
          const written = padding + (upper ? value.toUpperCase() : value) + padding
          expect(isTestDatabaseRequired({ REQUIRE_TEST_DB: written })).toBe(false)
        }
      )
    )
  })

  it('anything a person wrote to mean "on" is never read as "off"', () => {
    // The filter is the contract, not a retreat from a counterexample: the four
    // off-values are specified above, and every other spelling must fail loud.
    fc.assert(
      fc.property(
        fc.string().filter((s) => !OFF_VALUES.includes(s.trim().toLowerCase())),
        (value) => {
          expect(isTestDatabaseRequired({ REQUIRE_TEST_DB: value })).toBe(true)
        }
      )
    )
  })
})

describe('testDatabaseUrls (V7)', () => {
  it('uses only the database it was told to use', () => {
    const urls = testDatabaseUrls({ DATABASE_URL: 'postgresql://h/told' })
    expect(urls).toEqual(['postgresql://h/told'])
  })

  it('never falls back to the dev database when it was told which to use', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => s.trim().length > 0),
        (url) => {
          expect(testDatabaseUrls({ DATABASE_URL: url })).toEqual([url])
        }
      )
    )
  })

  it('falls back to the dev database only when it was told nothing', () => {
    expect(testDatabaseUrls({})).toEqual([DEV_DATABASE_URL])
    expect(testDatabaseUrls({ DATABASE_URL: '   ' })).toEqual([DEV_DATABASE_URL])
  })
})

describe('unavailableMessage (V5, V6, V8)', () => {
  const failure = {
    url: urlWithPassword('password'),
    error: new Error('connect ECONNREFUSED 127.0.0.1:5432'),
  }

  it('carries the reason the database was unusable (V5)', () => {
    expect(unavailableMessage([failure])).toContain('connect ECONNREFUSED 127.0.0.1:5432')
  })

  it('renders a thrown non-Error too (V5)', () => {
    expect(unavailableMessage([{ url: failure.url, error: 'schema is stale' }])).toContain(
      'schema is stale'
    )
  })

  it('carries the cause, not just the query that failed (V5)', () => {
    // What postgres-js actually throws: the useful half ("nothing is
    // listening") sits in `cause`, and the top-level message only says which
    // query died. Reporting the top level alone tells the operator nothing.
    const wrapped = new Error('Failed query: select 1', {
      cause: new Error('connect ECONNREFUSED 127.0.0.1:5432'),
    })
    const message = unavailableMessage([{ url: failure.url, error: wrapped }])
    expect(message).toContain('Failed query: select 1')
    expect(message).toContain('connect ECONNREFUSED 127.0.0.1:5432')
  })

  it('unpacks the addresses an AggregateError hides (V5)', () => {
    // `localhost` resolves to ::1 and 127.0.0.1, so Node reports the pair as
    // an AggregateError whose own message is empty and whose reasons sit in
    // `errors`. Reporting only the chain prints "caused by:" and nothing else,
    // which is how a refused connection reads as no reason at all.
    const aggregate = new AggregateError(
      [
        new Error('connect ECONNREFUSED ::1:5432'),
        new Error('connect ECONNREFUSED 127.0.0.1:5432'),
      ],
      ''
    )
    const wrapped = new Error('Failed query: select 1', { cause: aggregate })

    const message = unavailableMessage([{ url: failure.url, error: wrapped }])

    expect(message).toContain('ECONNREFUSED ::1:5432')
    expect(message).toContain('ECONNREFUSED 127.0.0.1:5432')
  })

  it('never reports a reason that says nothing (V5)', () => {
    const wrapped = new Error('Failed query: select 1', { cause: new Error('') })
    expect(unavailableMessage([{ url: failure.url, error: wrapped }])).not.toContain('caused by:')
  })

  it('follows a cause chain without running away on a cycle (V5)', () => {
    const inner: Error & { cause?: unknown } = new Error('inner')
    const outer = new Error('outer', { cause: inner })
    inner.cause = outer
    expect(unavailableMessage([{ url: failure.url, error: outer }])).toContain('inner')
  })

  it('names the database it tried (V6)', () => {
    expect(unavailableMessage([failure])).toContain('quackback_test')
  })

  it('says how to supply the missing database (V6)', () => {
    const message = unavailableMessage([failure])
    expect(message).toContain('Supply one with')
    expect(message).toContain('docker run')
    expect(message).toContain('pgvector/pgvector')
    expect(message).toContain('db:migrate')
  })

  it('says how to go back to skipping (V6)', () => {
    // Not just the variable's name — the first line already mentions that.
    // The operator needs the instruction.
    expect(unavailableMessage([failure])).toContain('unset REQUIRE_TEST_DB')
  })

  it('reports every candidate it tried (V5)', () => {
    const message = unavailableMessage([
      { url: 'postgresql://a/one', error: new Error('first reason') },
      { url: 'postgresql://b/two', error: new Error('second reason') },
    ])
    expect(message).toContain('first reason')
    expect(message).toContain('second reason')
  })

  it('holds up when nothing was tried at all (V6)', () => {
    expect(unavailableMessage([])).toContain('REQUIRE_TEST_DB')
  })

  it('carries every reason whatever the failure said (V5)', () => {
    fc.assert(
      fc.property(fc.string(), (reason) => {
        const message = unavailableMessage([{ url: failure.url, error: new Error(reason) }])
        expect(message).toContain(reason)
      })
    )
  })

  it('changing only the password never changes the message (V8)', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (left, right) => {
        const error = new Error('connect ECONNREFUSED')
        const withLeft = unavailableMessage([{ url: urlWithPassword(left), error }])
        const withRight = unavailableMessage([{ url: urlWithPassword(right), error }])
        expect(withLeft).toBe(withRight)
      })
    )
  })
})

describe('schemaStaleness (V4)', () => {
  it('a database at the same count as the journal is current', () => {
    expect(schemaStaleness(251, 251)).toBeNull()
  })

  it('a database behind the journal is stale, and says by how much', () => {
    const message = schemaStaleness(249, 251)
    expect(message).toContain('249 of 251')
    expect(message).toContain('db:migrate')
  })

  it('a database ahead of the journal is not stale', () => {
    // A branch that removed a migration still has a usable database, and a run
    // on it must not be blocked by a count it cannot satisfy.
    expect(schemaStaleness(252, 251)).toBeNull()
  })

  it('never calls a database stale unless it is actually behind', () => {
    fc.assert(
      fc.property(fc.nat({ max: 5000 }), fc.nat({ max: 5000 }), (applied, expected) => {
        const stale = schemaStaleness(applied, expected)
        // The unguarded law, holding across both branches: staleness and
        // being behind are the same thing, never merely correlated.
        expect(stale !== null).toBe(applied < expected)
      })
    )
  })

  it('names both counts whenever it reports staleness', () => {
    fc.assert(
      fc.property(fc.nat({ max: 5000 }), fc.nat({ max: 5000 }), (a, b) => {
        const applied = Math.min(a, b)
        const expected = Math.max(a, b)
        fc.pre(applied < expected)
        const message = schemaStaleness(applied, expected)
        expect(message).toContain(String(applied))
        expect(message).toContain(String(expected))
      })
    )
  })
})
