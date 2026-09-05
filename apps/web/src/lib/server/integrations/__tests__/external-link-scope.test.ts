/**
 * Which external link an inbound webhook is allowed to act on.
 *
 * An issue id is only unique inside its own container: GitLab hands out one
 * `iid` sequence per project, GitHub one number per repository. As long as an
 * instance targets exactly one project, `(integrationType, externalId)` is a
 * safe key. As soon as two boards route to two projects it is not — `#42`
 * exists in both, and a note from one product would land on the other
 * product's post as a team comment. This module is the rule that stops it.
 *
 * Contract (domain language, confirmed before these tests were written):
 *
 *   V8  A reply from GitLab — status change or comment — acts on exactly the
 *       post whose issue it concerns, never on a post of another product, even
 *       when the issue numbers match.
 *   V9  A reply that cannot be attributed to exactly one post does nothing.
 *       Nothing is ever guessed.
 *   V10 Links made before this change keep working unchanged, as long as no
 *       scoped link carries the same issue number; where one does, V9 decides.
 *
 * The qualifier on V10 is not a retreat from it, and it is one-directional. A
 * legacy link resolves until a *scoped* row appears on the same issue number,
 * and at that moment the report becomes unattributable: it names a project,
 * the scoped row says a different one, and the legacy row says nothing. V9
 * then decides, and V9 says do nothing. Per-board routing is what manufactures
 * those rows, so the remedy belongs there — fill in the scope of the legacy
 * rows before a second project starts issuing numbers. Never by relaxing the
 * rule here.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { selectLinksForScope } from '../external-link-scope'

/** A link row reduced to what the rule reads. */
function link(id: string, externalScope: string | null) {
  return { id, externalScope }
}

describe('selectLinksForScope', () => {
  it('picks the link from the reporting project and leaves the other alone (V8)', () => {
    const rows = [link('link_datenschutz', '101'), link('link_asbs', '202')]

    expect(selectLinksForScope(rows, '202')).toEqual([link('link_asbs', '202')])
  })

  it('returns every link in the reporting project, since one issue can back several tickets (V8)', () => {
    const rows = [link('a', '101'), link('b', '101'), link('c', '202')]

    expect(selectLinksForScope(rows, '101')).toEqual([link('a', '101'), link('b', '101')])
  })

  it('acts on nothing when the reporting project has no link here (V9)', () => {
    const rows = [link('link_datenschutz', '101')]

    expect(selectLinksForScope(rows, '999')).toEqual([])
  })

  it('acts on nothing when no link matches and a competing project is on record (V9)', () => {
    // The unscoped row is a legacy link, but a scoped row for a *different*
    // project proves this external id is not unique across projects. Guessing
    // here is exactly the cross-product leak V8 forbids.
    const rows = [link('legacy', null), link('link_asbs', '202')]

    expect(selectLinksForScope(rows, '101')).toEqual([])
  })

  it('still resolves a legacy link when nothing contradicts it (V10)', () => {
    const rows = [link('legacy', null)]

    expect(selectLinksForScope(rows, '101')).toEqual([link('legacy', null)])
  })

  it('resolves legacy links unchanged when the provider reports no project at all (V10)', () => {
    // The ten providers that do not report a container keep today's behaviour.
    const rows = [link('a', null), link('b', null)]

    expect(selectLinksForScope(rows, undefined)).toEqual([link('a', null), link('b', null)])
  })

  it('acts on nothing when no project is reported and the links span several (V9)', () => {
    const rows = [link('a', '101'), link('b', '202')]

    expect(selectLinksForScope(rows, undefined)).toEqual([])
  })

  it('resolves when no project is reported and every link agrees on one (V10)', () => {
    const rows = [link('a', '101'), link('b', '101')]

    expect(selectLinksForScope(rows, undefined)).toEqual([link('a', '101'), link('b', '101')])
  })

  it('acts on nothing when there is no link at all (V9)', () => {
    expect(selectLinksForScope([], '101')).toEqual([])
    expect(selectLinksForScope([], undefined)).toEqual([])
  })
})

describe('selectLinksForScope — properties', () => {
  const arbScope = fc.option(fc.constantFrom('101', '202', '303'), { nil: null })
  const arbRows = fc.array(
    fc.record({ id: fc.string({ minLength: 1, maxLength: 6 }), externalScope: arbScope }),
    { maxLength: 8 }
  )
  const arbReported = fc.option(fc.constantFrom('101', '202', '303'), { nil: undefined })

  it('never returns a link that belongs to a different project (V8)', () => {
    fc.assert(
      fc.property(arbRows, arbReported, (rows, reported) => {
        for (const selected of selectLinksForScope(rows, reported)) {
          // A selected link is either from the reporting project, or carries
          // no project at all. It is never from a project we can name and
          // that is not the one reporting.
          expect(
            selected.externalScope === null ||
              reported === undefined ||
              selected.externalScope === reported
          ).toBe(true)
        }
      })
    )
  })

  it('returns a subset of what it was given, never invents a link (V9)', () => {
    fc.assert(
      fc.property(arbRows, arbReported, (rows, reported) => {
        const selected = selectLinksForScope(rows, reported)
        expect(selected.length).toBeLessThanOrEqual(rows.length)
        for (const s of selected) expect(rows).toContain(s)
      })
    )
  })

  it('selects links that all agree on one project — never a mix (V8)', () => {
    fc.assert(
      fc.property(arbRows, arbReported, (rows, reported) => {
        const scopes = new Set(selectLinksForScope(rows, reported).map((r) => r.externalScope))
        expect(scopes.size).toBeLessThanOrEqual(1)
      })
    )
  })

  it('ignores the order the rows arrive in (V9)', () => {
    fc.assert(
      fc.property(arbRows, arbReported, (rows, reported) => {
        const forward = selectLinksForScope(rows, reported)
        const backward = selectLinksForScope([...rows].reverse(), reported)
        expect([...backward].reverse()).toEqual(forward)
      })
    )
  })

  it('a link from an unrelated project is never selected, and never widens a named selection (V8)', () => {
    // Non-interference. The first assertion is unguarded and is the real
    // claim: another product's link is never a target when the webhook names
    // its own project.
    //
    // The second is deliberately conditional, because the contract only
    // promises it there. When the provider names no project — the ten
    // providers that report no container, and every pre-existing link — "a
    // link from another project" is not a distinguishable thing, and V10
    // keeps today's behaviour: a single unambiguous candidate wins. So an
    // unrelated link CAN become that candidate when there was none before,
    // and asserting otherwise would state a promise nobody made.
    fc.assert(
      fc.property(
        arbRows,
        arbReported,
        fc.string({ minLength: 1, maxLength: 6 }),
        (rows, reported, id) => {
          const unrelated = { id, externalScope: '999' }
          const before = selectLinksForScope(rows, reported)
          const after = selectLinksForScope([...rows, unrelated], reported)

          if (reported !== undefined) {
            expect(after).not.toContain(unrelated)
            expect(after.length).toBeLessThanOrEqual(before.length)
          }
          // Unguarded, both branches: whatever comes back agrees on one
          // project, so a mixed selection can never arise from the addition.
          expect(new Set(after.map((r) => r.externalScope)).size).toBeLessThanOrEqual(1)
        }
      )
    )
  })
})
