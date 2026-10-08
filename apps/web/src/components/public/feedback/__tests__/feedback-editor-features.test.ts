import { describe, expect, it } from 'vitest'
import { PORTAL_POST_EDITOR_FEATURES } from '../portal-post-editor-features'

// Upstream #568 adds its own preset for this; the fork already had one
// (portal-post-editor-features.ts), so the upstream test is kept against it.
describe('public feedback editor preset', () => {
  it('offers heading formatting in the public composer', () => {
    expect(PORTAL_POST_EDITOR_FEATURES.headings).toBe(true)
  })
})
