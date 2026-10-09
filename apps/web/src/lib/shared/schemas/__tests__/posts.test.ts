import { describe, it, expect } from 'vitest'
import { listPublicPostsSchema, tiptapContentSchema } from '../posts'

describe('tiptapContentSchema', () => {
  it('accepts link marks with null title attribute', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Check out ' },
            {
              type: 'text',
              text: 'https://example.com',
              marks: [
                {
                  type: 'link',
                  attrs: {
                    href: 'https://example.com',
                    target: '_blank',
                    rel: 'noopener noreferrer nofollow',
                    class: null,
                    title: null,
                  },
                },
              ],
            },
          ],
        },
      ],
    }
    const result = tiptapContentSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('accepts link marks without optional attrs', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'a link',
              marks: [
                {
                  type: 'link',
                  attrs: { href: 'https://example.com' },
                },
              ],
            },
          ],
        },
      ],
    }
    const result = tiptapContentSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('rejects mark attrs with non-primitive values', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'bad',
              marks: [
                {
                  type: 'bold',
                  attrs: { evil: { nested: 'object' } },
                },
              ],
            },
          ],
        },
      ],
    }
    const result = tiptapContentSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})

// Since #555 the portal and the widget validate a post-list request through
// this one schema, so a filter the portal refused before is refused on both.
describe('listPublicPostsSchema dateFrom (J21)', () => {
  it('accepts a real calendar date (J21)', () => {
    const parsed = listPublicPostsSchema.parse({ dateFrom: '2026-02-28' })
    expect(parsed.dateFrom).toBe('2026-02-28')
  })

  it('refuses a date in the right shape that names no day of the calendar (J21)', () => {
    const result = listPublicPostsSchema.safeParse({ dateFrom: '2026-13-01' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Invalid calendar date')
  })

  it('refuses a date in any other shape (J21)', () => {
    expect(listPublicPostsSchema.safeParse({ dateFrom: '28.02.2026' }).success).toBe(false)
  })
})
