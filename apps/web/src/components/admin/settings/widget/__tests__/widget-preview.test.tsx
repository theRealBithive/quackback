// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "handleDisabledFileLoadingAsSuccess": true } }
/**
 * <WidgetPreview> — admin widget settings live preview.
 *
 * The preview embeds the real `/widget` app in an iframe and the real SDK
 * launcher (createLauncher) in the fake page:
 *   - The iframe targets /widget with the selected theme forced via ?theme=.
 *   - The launcher button toggles the panel open/closed.
 *   - Panel and launcher share a bottom corner (panel above, button below).
 *   - An optional greeting bubble sits above the closed launcher.
 *   - The widget's own close button messages its host (quackback:close);
 *     the preview honours it like the SDK would, but only from its own origin.
 *
 * ## P — Widget install pairing (upstream 98b18e3ee)
 * - P5 The admin preview mounts the real launcher: it takes the site's light and
 *   dark colours from the widget config, applies them once the config loads and
 *   again when the theme switches, mirrors the unread count the iframe reports,
 *   and keeps the default look when the config cannot be fetched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { WidgetPreview } from '../widget-preview'

function sendClose(origin: string) {
  fireEvent(window, new MessageEvent('message', { data: { type: 'quackback:close' }, origin }))
}

function sendUnread(origin: string, count: number | undefined) {
  fireEvent(
    window,
    new MessageEvent('message', { data: { type: 'quackback:unread', count }, origin })
  )
}

function launcher() {
  return screen.getByRole('button', { name: /feedback widget/i })
}

describe('WidgetPreview', () => {
  beforeEach(() => {
    try {
      sessionStorage.clear()
    } catch {
      /* ignore */
    }
  })

  it('embeds the real widget with the selected theme forced', () => {
    render(<WidgetPreview position="bottom-right" theme="dark" />)

    const iframe = screen.getByTitle<HTMLIFrameElement>('Widget preview')
    expect(iframe.getAttribute('src')).toBe('/widget?theme=dark')
  })

  it('uses the real SDK launcher button', () => {
    render(<WidgetPreview position="bottom-right" />)

    const btn = launcher()
    expect(btn.querySelector('svg')).toBeTruthy()
    expect(btn.style.position).toBe('absolute')
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(btn.className).not.toContain('bg-primary')
    expect(btn.style.backgroundColor).toBeTruthy()
  })

  it('turns the real launcher into a pill when a label is set', () => {
    render(<WidgetPreview position="bottom-right" label="Feedback" />)

    expect(launcher().textContent).toContain('Feedback')
    expect(launcher().style.borderRadius).toBe('24px')
  })

  it('toggles the panel via the launcher button', () => {
    render(<WidgetPreview position="bottom-right" />)

    fireEvent.click(launcher())
    expect(screen.queryByTitle('Widget preview')).toBeNull()

    fireEvent.click(launcher())
    expect(screen.getByTitle('Widget preview')).toBeTruthy()
  })

  it('closes the panel when the widget posts quackback:close from our origin', () => {
    render(<WidgetPreview position="bottom-right" />)

    sendClose(window.location.origin)
    expect(screen.queryByTitle('Widget preview')).toBeNull()
  })

  it('ignores quackback:close from foreign origins', () => {
    render(<WidgetPreview position="bottom-right" />)

    sendClose('https://evil.example')
    expect(screen.getByTitle('Widget preview')).toBeTruthy()
  })

  it('places the launcher on the configured side', () => {
    render(<WidgetPreview position="bottom-left" />)

    expect(launcher().style.left).toBe('0px')
    expect(launcher().style.right).toBe('')
  })

  it('stacks the open panel above the launcher in the same corner', () => {
    render(<WidgetPreview position="bottom-right" />)

    const panel = screen.getByTitle('Widget preview').parentElement
    const btn = launcher()
    expect(panel?.className).toContain('bottom-[88px]')
    expect(btn.style.bottom).toBe('0px')
    expect(btn.style.right).toBe('0px')
    expect(panel?.parentElement?.className).toContain('w-[400px]')
    expect(panel?.parentElement?.parentElement?.className).toContain('items-center')
    expect(panel?.parentElement?.parentElement?.className).toContain('justify-center')
  })

  it('shows the launcher greeting bubble while the panel is closed', () => {
    render(<WidgetPreview position="bottom-right" greeting="Need a hand?" />)

    const bubble = () => screen.getByText('Need a hand?').parentElement
    expect(bubble()?.style.display).toBe('none')
    fireEvent.click(launcher())
    expect(bubble()?.style.display).toBe('flex')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(bubble()?.style.display).toBe('none')
  })

  it('opens the panel when the greeting bubble is clicked', () => {
    render(<WidgetPreview position="bottom-right" greeting="Hi there" />)

    fireEvent.click(launcher())
    expect(screen.queryByTitle('Widget preview')).toBeNull()

    fireEvent.click(screen.getByText('Hi there'))
    expect(screen.getByTitle('Widget preview')).toBeTruthy()
    expect(screen.getByText('Hi there').parentElement?.style.display).toBe('none')
  })

  it('places the greeting bubble on the same side as the launcher', () => {
    render(<WidgetPreview position="bottom-left" greeting="Hello" />)

    fireEvent.click(launcher())
    expect(screen.getByText('Hello').parentElement?.style.left).toBe('0px')
  })

  it('does not persist greeting dismiss to the host-page session key', () => {
    render(<WidgetPreview position="bottom-right" greeting="Need a hand?" />)
    fireEvent.click(launcher())
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(sessionStorage.getItem('quackback:launcher-greeting-dismissed')).toBeNull()
  })
})

describe('WidgetPreview launcher theme, unread and defaults', () => {
  // The SDK brand defaults the launcher paints before any config arrives.
  const DEFAULT_BACKGROUND = '#000000'
  const DEFAULT_FOREGROUND = '#facc15'

  function stubConfigFetch(config: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => config })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  beforeEach(() => {
    try {
      sessionStorage.clear()
    } catch {
      /* ignore */
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('paints the launcher in the site light colours once the config loads (P5)', async () => {
    stubConfigFetch({
      theme: {
        lightPrimary: '#1d4ed8',
        lightPrimaryForeground: '#f8fafc',
        darkPrimary: '#0f172a',
        darkPrimaryForeground: '#e2e8f0',
      },
    })

    render(<WidgetPreview position="bottom-right" theme="light" />)

    await waitFor(() => {
      expect(launcher().style.backgroundColor).toBe('#1d4ed8')
    })
    expect(launcher().style.color).toBe('#f8fafc')
  })

  it('repaints in the dark colours when the theme switches (P5)', async () => {
    stubConfigFetch({
      theme: {
        lightPrimary: '#1d4ed8',
        lightPrimaryForeground: '#f8fafc',
        darkPrimary: '#0f172a',
        darkPrimaryForeground: '#e2e8f0',
      },
    })

    const view = render(<WidgetPreview position="bottom-right" theme="light" />)
    await waitFor(() => {
      expect(launcher().style.backgroundColor).toBe('#1d4ed8')
    })

    // Same mounted launcher, new theme: the cached config is re-applied.
    await act(async () => {
      view.rerender(<WidgetPreview position="bottom-right" theme="dark" />)
    })

    await waitFor(() => {
      expect(launcher().style.backgroundColor).toBe('#0f172a')
    })
    expect(launcher().style.color).toBe('#e2e8f0')
  })

  it('uses the light colours in dark mode when the site defines no dark pair (P5)', async () => {
    stubConfigFetch({
      theme: { lightPrimary: '#1d4ed8', lightPrimaryForeground: '#f8fafc' },
    })

    render(<WidgetPreview position="bottom-right" theme="dark" />)

    await waitFor(() => {
      expect(launcher().style.backgroundColor).toBe('#1d4ed8')
    })
    expect(launcher().style.color).toBe('#f8fafc')
  })

  it('keeps the default look when the config carries no theme (P5)', async () => {
    const fetchMock = stubConfigFetch({ enabled: true })

    render(<WidgetPreview position="bottom-right" />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/widget/config.json')
    })
    await act(async () => {})
    expect(launcher().style.backgroundColor).toBe(DEFAULT_BACKGROUND)
    expect(launcher().style.color).toBe(DEFAULT_FOREGROUND)
  })

  it('keeps the default look when the config request fails (P5)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)

    render(<WidgetPreview position="bottom-right" />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    await act(async () => {})
    expect(launcher().style.backgroundColor).toBe(DEFAULT_BACKGROUND)
    expect(launcher().style.color).toBe(DEFAULT_FOREGROUND)
  })

  it('keeps the default look when the config responds with an error status (P5)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ theme: { lightPrimary: '#1d4ed8' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WidgetPreview position="bottom-right" />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    await act(async () => {})
    expect(launcher().style.backgroundColor).toBe(DEFAULT_BACKGROUND)
  })

  it('mirrors the unread count the widget iframe reports (P5)', () => {
    render(<WidgetPreview position="bottom-right" />)

    // The badge only shows while the panel is closed, as it does on a real site.
    fireEvent.click(launcher())
    sendUnread(window.location.origin, 3)

    const badge = launcher().lastElementChild as HTMLElement
    expect(badge.textContent).toBe('3')
    expect(badge.style.display).toBe('flex')
  })

  it('clears the badge when the iframe reports no count (P5)', () => {
    render(<WidgetPreview position="bottom-right" />)

    fireEvent.click(launcher())
    sendUnread(window.location.origin, 2)
    sendUnread(window.location.origin, undefined)

    const badge = launcher().lastElementChild as HTMLElement
    expect(badge.textContent).toBe('0')
    expect(badge.style.display).toBe('none')
  })

  it('ignores an unread report from a foreign origin (P5)', () => {
    render(<WidgetPreview position="bottom-right" />)

    fireEvent.click(launcher())
    sendUnread('https://evil.example', 7)

    expect((launcher().lastElementChild as HTMLElement).style.display).toBe('none')
  })
})
