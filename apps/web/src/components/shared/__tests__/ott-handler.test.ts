// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { isPortalOttPath, OttHandler, portalOttForwardUrl } from '../ott-handler'

const router = vi.hoisted(() => ({ location: { pathname: '/', searchStr: '' } }))
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (state: typeof router) => unknown }) => select(router),
}))

describe('isPortalOttPath', () => {
  it('handles widget portal handoff URLs', () => {
    expect(isPortalOttPath('/')).toBe(true)
    expect(isPortalOttPath('/b/ideas')).toBe(true)
    expect(isPortalOttPath('/admin')).toBe(true)
  })

  it('leaves dedicated consume routes alone', () => {
    expect(isPortalOttPath('/auth/open-handoff')).toBe(false)
    expect(isPortalOttPath('/auth/origin-transfer')).toBe(false)
    expect(isPortalOttPath('/auth/widget-handoff')).toBe(false)
    expect(isPortalOttPath('/auth/login')).toBe(false)
  })
})

describe('portalOttForwardUrl', () => {
  it('forwards leftover ott to widget-handoff with the resource as returnTo', () => {
    expect(portalOttForwardUrl('/b/ideas/posts/post_1', '?ott=abc')).toBe(
      '/auth/widget-handoff?ott=abc&returnTo=%2Fb%2Fideas%2Fposts%2Fpost_1'
    )
  })

  it('keeps other query params on returnTo', () => {
    expect(portalOttForwardUrl('/changelog/entry_1', '?ott=abc&locale=fr')).toBe(
      '/auth/widget-handoff?ott=abc&returnTo=%2Fchangelog%2Fentry_1%3Flocale%3Dfr'
    )
  })

  it('returns null without ott or on consume routes', () => {
    expect(portalOttForwardUrl('/b/ideas', '')).toBeNull()
    expect(portalOttForwardUrl('/auth/widget-handoff', '?ott=abc')).toBeNull()
  })
})

describe('OttHandler (J11)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function mountAt(pathname: string, searchStr: string) {
    router.location = { pathname, searchStr }
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    const view = render(createElement(OttHandler))
    return { replace, view }
  }

  it('hands a portal page that still carries a token to the handoff route, once (J11)', () => {
    const { replace, view } = mountAt('/b/ideas/posts/post_1', '?ott=abc')

    expect(replace).toHaveBeenCalledWith(
      '/auth/widget-handoff?ott=abc&returnTo=%2Fb%2Fideas%2Fposts%2Fpost_1'
    )

    // A re-render of the same location must not navigate a second time.
    view.rerender(createElement(OttHandler))
    expect(replace).toHaveBeenCalledTimes(1)
  })

  it('leaves the handoff route itself and a page without a token alone (J11)', () => {
    const onHandoff = mountAt('/auth/widget-handoff', '?ott=abc')
    expect(onHandoff.replace).not.toHaveBeenCalled()
    cleanup()

    const withoutToken = mountAt('/b/ideas', '')
    expect(withoutToken.replace).not.toHaveBeenCalled()
  })
})
