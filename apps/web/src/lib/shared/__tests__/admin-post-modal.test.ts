/**
 * Which admin pages the layout opens the feedback post modal on.
 *
 * Contract (confirmed 2026-11-06), a partial port of upstream #563:
 *
 * R1 On the roadmap, a post opens exactly one modal: the roadmap's.
 * R2 On every other admin page, ?post= still opens the feedback post modal.
 * R3 The one modal that is open is reachable for keyboard and screen-reader
 *    users — it is not aria-hidden.
 *
 * R1 and R3 are also held end to end by `e2e/tests/admin/roadmap.spec.ts`
 * ("clicking a card opens detail modal with matching title"), which finds
 * the modal by its role; R2 by `e2e/tests/admin/post-management.spec.ts`.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { layoutOpensPostModal } from '../admin-post-modal'

const otherAdminPages = [
  '/admin',
  '/admin/feedback',
  '/admin/overview',
  '/admin/users',
  '/admin/changelog',
  '/admin/settings/boards',
  '/admin/roadmaps',
  '/admin/roadmap-archive',
]

describe('the layout and the post modal', () => {
  it('leaves the roadmap page and its sub-pages to the roadmap modal (R1)', () => {
    expect(layoutOpensPostModal('/admin/roadmap')).toBe(false)
    expect(layoutOpensPostModal('/admin/roadmap/')).toBe(false)
    expect(layoutOpensPostModal('/admin/roadmap/roadmap_01abc')).toBe(false)
  })

  it('opens the feedback modal on every other admin page (R2)', () => {
    for (const pathname of otherAdminPages) {
      expect(layoutOpensPostModal(pathname)).toBe(true)
    }
  })

  it('opens it on any page whose path does not sit under the roadmap (R2)', () => {
    const segment = fc.stringMatching(/^[a-z0-9-]{1,12}$/)
    fc.assert(
      fc.property(fc.array(segment, { minLength: 1, maxLength: 3 }), (segments) => {
        const pathname = `/admin/${segments.join('/')}`
        const underRoadmap = segments[0] === 'roadmap'
        expect(layoutOpensPostModal(pathname)).toBe(!underRoadmap)
      })
    )
  })
})
