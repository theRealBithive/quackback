// @vitest-environment happy-dom
/**
 * The workspace default post template on the Portal settings page. The
 * contract is listed in full in `lib/shared/__tests__/post-template.test.ts`;
 * this suite holds the page's half of:
 *
 *   V2  A board without its own template prefills the workspace default template.
 *   V11 Saving a board's template never discards the board's other settings
 *       (roadmap statuses, custom fields).
 *
 * The page commits through one save bar. What it must get right for the
 * template: the stored default is what the card opens on, an edit is sent on
 * save and nothing is sent for a template nobody touched (so saving the nav
 * cannot rewrite the template with a stale copy), and "Discard" restores it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { TiptapContent } from '@/lib/shared/db-types'

const hoisted = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  portalConfig: {} as Record<string, unknown>,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useRouteContext: () => ({ settings: { name: 'Acme' }, session: null }),
  }),
  useBlocker: () => {},
  useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useSuspenseQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === 'portalConfig') return { data: hoisted.portalConfig }
    if (queryKey[0] === 'customCss') return { data: '' }
    return { data: {} }
  },
}))

vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    branding: () => ({ queryKey: ['branding'] }),
    logo: () => ({ queryKey: ['logo'] }),
    customCss: () => ({ queryKey: ['customCss'] }),
    portalConfig: () => ({ queryKey: ['portalConfig'] }),
  },
}))

vi.mock('@/components/admin/settings/branding/use-branding-state', () => ({
  FONT_OPTIONS: [],
  useBrandingState: () => ({
    activePresetId: null,
    cssText: '',
    currentFontId: 'inter',
    font: 'inter',
    previewMode: 'light',
    previewModeDisabled: false,
    radius: 0.5,
    themeMode: 'user',
    saveTheme: vi.fn(),
    setCssText: vi.fn(),
    setFont: vi.fn(),
    setPreset: vi.fn(),
    setPreviewMode: vi.fn(),
    setRadius: vi.fn(),
    setThemeMode: vi.fn(),
  }),
}))

vi.mock('@/lib/client/mutations/settings', () => ({
  useUpdatePortalConfig: () => ({ mutateAsync: hoisted.mutateAsync }),
}))
vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  useImageUpload: () => ({ upload: vi.fn() }),
  useMediaUpload: () => ({ upload: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/ui/select', async () => ({
  ...(await import('@/test/radix-select')),
  SelectGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectLabel: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/ui/slider', () => ({ Slider: () => null }))
vi.mock('@/components/admin/settings/branding/portal-preview', () => ({
  PortalPreview: () => null,
}))
vi.mock('@/components/admin/settings/preview-toggle', () => ({ PreviewToggleButton: () => null }))
vi.mock('@/components/admin/upgrade', () => ({ UpgradeModal: () => null }))
vi.mock('@/components/admin/settings/branding/portal-nav-editor', () => ({
  PortalNavEditor: () => null,
  isValidNavLinkUrl: () => true,
}))

// Each editor shows its document and offers one edit, told apart by placeholder.
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: unknown
    onChange?: (json: unknown) => void
    placeholder?: string
  }) => (
    <div data-testid={`editor:${placeholder}`}>
      <pre>{JSON.stringify(value)}</pre>
      <button
        type="button"
        onClick={() =>
          onChange?.({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Edited' }] }],
          })
        }
      >
        edit {placeholder}
      </button>
    </div>
  ),
}))

const { Route } = await import('../settings.portal')
const PortalPage = (Route as unknown as { options: { component: () => ReactNode } }).options
  .component

const TEMPLATE_PLACEHOLDER = 'e.g. What are you trying to do? What would help?'
const WELCOME_PLACEHOLDER = "Tell visitors what kind of feedback you'd love to hear…"

function docSaying(text: string): TiptapContent {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

function templateCardShows(): unknown {
  const card = screen.getByTestId(`editor:${TEMPLATE_PLACEHOLDER}`)
  return JSON.parse(card.querySelector('pre')?.textContent ?? 'null')
}

describe('the default post template card', () => {
  beforeEach(() => {
    hoisted.mutateAsync.mockReset()
    hoisted.mutateAsync.mockResolvedValue({})
    hoisted.portalConfig = { postTemplate: docSaying('Stored default') }
  })
  afterEach(cleanup)

  it('opens on the stored workspace default (V2)', () => {
    render(<PortalPage />)
    expect(templateCardShows()).toEqual(docSaying('Stored default'))
  })

  it('opens on an empty template when none is stored (V2)', () => {
    hoisted.portalConfig = {}
    render(<PortalPage />)
    expect(JSON.stringify(templateCardShows())).not.toContain('"text"')
  })

  it('sends the edited template on save (V2)', async () => {
    render(<PortalPage />)
    fireEvent.click(screen.getByRole('button', { name: `edit ${TEMPLATE_PLACEHOLDER}` }))

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(hoisted.mutateAsync).toHaveBeenCalledTimes(1))
    expect(hoisted.mutateAsync.mock.calls[0][0]).toEqual({ postTemplate: docSaying('Edited') })
  })

  it('sends no template when only another card changed (V11)', async () => {
    render(<PortalPage />)
    fireEvent.click(screen.getByRole('button', { name: `edit ${WELCOME_PLACEHOLDER}` }))

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(hoisted.mutateAsync).toHaveBeenCalledTimes(1))
    expect(hoisted.mutateAsync.mock.calls[0][0]).not.toHaveProperty('postTemplate')
  })

  it('treats a saved template as the new baseline (V2)', async () => {
    render(<PortalPage />)
    fireEvent.click(screen.getByRole('button', { name: `edit ${TEMPLATE_PLACEHOLDER}` }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(hoisted.mutateAsync).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: `edit ${WELCOME_PLACEHOLDER}` }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(hoisted.mutateAsync).toHaveBeenCalledTimes(2))
    expect(hoisted.mutateAsync.mock.calls[1][0]).not.toHaveProperty('postTemplate')
  })

  it('restores the stored template on discard (V2)', () => {
    render(<PortalPage />)
    fireEvent.click(screen.getByRole('button', { name: `edit ${TEMPLATE_PLACEHOLDER}` }))
    expect(templateCardShows()).toEqual(docSaying('Edited'))

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(templateCardShows()).toEqual(docSaying('Stored default'))
  })
})
