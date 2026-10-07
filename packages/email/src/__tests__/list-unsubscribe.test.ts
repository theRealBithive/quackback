/**
 * The List-Unsubscribe headers a notification email carries.
 *
 * Contract (upstream #687), verbatim:
 *
 *   U1 Opening an unsubscribe link never unsubscribes anyone. It shows what would happen and asks for confirmation.
 *   U2 The unsubscribe happens only on an explicit confirmation, or on a one-click request from the mail provider.
 *   U3 A malformed, unknown, used or expired token shows the expired-link page, never a server error.
 *   U4 A one-click request in the RFC 8058 form is answered with success for every token, whether live, used, unknown or malformed. A request without the one-click body is refused. A body larger than 1 KB is refused after reading no more than that.
 *   U5 A token is spent only once the opt-out has actually happened. If the opt-out fails, the link keeps working and a retry succeeds exactly once.
 *   U6 Unsubscribing from the changelog also stops the changelog mail that reaches a person through posts they follow, even if they never subscribed to the changelog.
 *   U7 Every notification email that has an unsubscribe link carries List-Unsubscribe. It offers one-click only when the link is HTTPS. An email without a link carries neither header.
 *   U8 The unsubscribe page is in the language the rest of the site resolved for the request, in all nine languages, and the German addresses the reader formally.
 *   U9 The unsubscribe page's strings are not loaded into the portal or the widget.
 *
 * This module holds U7 for the header builder itself. That every sender
 * attaches what it builds is in list-unsubscribe-senders.test.ts.
 *
 * The link ends up inside a mail header, so it is input crossing into a
 * protocol that a stray CR or LF would let a caller extend (OWASP A03,
 * injection). The "no line break, one bracketed URL" property below is the
 * check that sits at that sink.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { listUnsubscribeHeaders } from '../list-unsubscribe'

const ONE_CLICK = 'List-Unsubscribe=One-Click'
const HEADER_NAMES = ['List-Unsubscribe', 'List-Unsubscribe-Post']

function linkWithScheme(scheme: 'https' | 'http') {
  return fc.webUrl({ validSchemes: [scheme], withQueryParameters: true, withFragments: true })
}

describe('listUnsubscribeHeaders', () => {
  it('(U7) an https link gets List-Unsubscribe and the one-click offer', () => {
    fc.assert(
      fc.property(linkWithScheme('https'), (link) => {
        expect(listUnsubscribeHeaders(link)).toEqual({
          'List-Unsubscribe': `<${new URL(link).href}>`,
          'List-Unsubscribe-Post': ONE_CLICK,
        })
      })
    )
  })

  it('(U7) a plain http link gets List-Unsubscribe without the one-click offer', () => {
    fc.assert(
      fc.property(linkWithScheme('http'), (link) => {
        expect(listUnsubscribeHeaders(link)).toEqual({
          'List-Unsubscribe': `<${new URL(link).href}>`,
        })
      })
    )
  })

  it('(U7) the one-click offer follows the scheme, not the letters of the link', () => {
    expect(listUnsubscribeHeaders('HTTPS://Acme.test/unsubscribe?token=t')).toEqual({
      'List-Unsubscribe': '<https://acme.test/unsubscribe?token=t>',
      'List-Unsubscribe-Post': ONE_CLICK,
    })
    expect(listUnsubscribeHeaders('http://acme.test/https/unsubscribe')).toEqual({
      'List-Unsubscribe': '<http://acme.test/https/unsubscribe>',
    })
  })

  it('(U7) no link means neither header', () => {
    expect(listUnsubscribeHeaders(undefined)).toEqual({})
    expect(listUnsubscribeHeaders('')).toEqual({})
  })

  it('(U7) a link that is not a URL means neither header', () => {
    expect(listUnsubscribeHeaders('not a url')).toEqual({})
    expect(listUnsubscribeHeaders('/unsubscribe?token=relative')).toEqual({})
  })

  it('(U7) a link in any scheme but http or https means neither header', () => {
    const otherScheme = fc.constantFrom(
      'mailto:unsubscribe@acme.test',
      'ftp://acme.test/unsubscribe',
      'javascript:alert(1)',
      'data:text/plain,unsubscribe',
      'file:///etc/passwd',
      'ws://acme.test/unsubscribe',
      'httpx://acme.test/unsubscribe'
    )
    fc.assert(
      fc.property(otherScheme, (link) => {
        expect(listUnsubscribeHeaders(link)).toEqual({})
      })
    )
  })

  it('(U7) whatever the input, the headers are well formed and one-click only rides on https', () => {
    const anyLink = fc.oneof(
      linkWithScheme('https'),
      linkWithScheme('http'),
      fc.string(),
      fc
        .tuple(linkWithScheme('https'), fc.constantFrom('\r\n', '\n', '\r', '>', '<'), fc.string())
        .map(([link, breaker, tail]) => link + breaker + tail)
    )
    fc.assert(
      fc.property(anyLink, (link) => {
        const headers = listUnsubscribeHeaders(link)
        const names = Object.keys(headers)
        const offersOneClick = 'List-Unsubscribe-Post' in headers
        const value = headers['List-Unsubscribe']

        for (const name of names) expect(HEADER_NAMES).toContain(name)
        if (offersOneClick) {
          expect(headers['List-Unsubscribe-Post']).toBe(ONE_CLICK)
          expect(value).toBeDefined()
        }
        expect(offersOneClick).toBe(value !== undefined && value.startsWith('<https://'))
        if (value !== undefined) {
          expect(value).toMatch(/^<[^<>\r\n]+>$/)
        }
      })
    )
  })

  it('(U7) a line break smuggled into the link cannot add a header', () => {
    const headers = listUnsubscribeHeaders(
      'https://acme.test/unsubscribe?token=t\r\nBcc: victim@example.test'
    )

    expect(Object.keys(headers).sort()).toEqual(HEADER_NAMES)
    expect(headers['List-Unsubscribe']).not.toMatch(/[\r\n]/)
  })
})
