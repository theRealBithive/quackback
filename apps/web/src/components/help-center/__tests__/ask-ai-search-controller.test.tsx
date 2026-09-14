// @vitest-environment happy-dom
/**
 * ## W — Widget `open()` deep-links (upstream #531)
 * - W6 Help search, help categories, article detail, changelog list and detail, Ask AI and the unread badge all carry the widget identity and are keyed by session, so identify or logout refetches them and no placeholder from another identity is shown.
 * - W7 When the session changes, help search drops its results, its in-flight request and its cache; a response from an earlier session is discarded; a non-OK response yields no results.
 * - W11 Resolving a public article accepts an `article_` id, a retired `kb_article_` id or a slug; it falls back to the default locale when the requested one has no version and reports the locale it resolved to; helpfulness counters are not exposed; an article that does not exist or is not public resolves to nothing.
 *
 * This module pins W6 and W7 for `useAskAiAvailable` and
 * `useAskAiSearchController`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ReactNode, KeyboardEvent } from 'react'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { aguiRun, stubAguiFetch } from '@/test/agui'
import { useAskAiAvailable, useAskAiSearchController } from '../ask-ai'

afterEach(() => {
  vi.unstubAllGlobals()
})

function withQueryClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

describe('useAskAiAvailable', () => {
  it('carries the widget identity headers on the capability probe (W6)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: { enabled: true } }) })
    vi.stubGlobal('fetch', fetchMock)
    const getHeaders = () => ({ Authorization: 'Bearer widget-token' })

    const { result } = renderHook(
      () => useAskAiAvailable(true, { getHeaders, sessionVersion: 1 }),
      { wrapper: withQueryClient() }
    )

    await waitFor(() => expect(result.current).toBe(true))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/widget/kb-ask',
      expect.objectContaining({ headers: { Authorization: 'Bearer widget-token' } })
    )
  })

  it('is false when the probe responds but the capability is disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { enabled: false } }) })
    )

    const { result } = renderHook(() => useAskAiAvailable(true, {}), {
      wrapper: withQueryClient(),
    })

    await waitFor(() => expect(result.current).toBe(false))
  })
})

describe('useAskAiSearchController', () => {
  function controllerProps(overrides: Partial<Parameters<typeof useAskAiSearchController>[0]>) {
    return {
      query: 'refund',
      askAiAvailable: true,
      resultCount: 3,
      onSelectResult: vi.fn(),
      onClearQuery: vi.fn(),
      ...overrides,
    }
  }

  it('resets the Ask AI answer and clears the keyboard selection when the session changes (W6, W7)', async () => {
    stubAguiFetch(aguiRun({ result: { kind: 'grounded', answer: 'Do the thing.', sources: [] } }))

    const { result, rerender } = renderHook(
      (props: { sessionVersion: number }) =>
        useAskAiSearchController(controllerProps({ sessionVersion: props.sessionVersion })),
      { initialProps: { sessionVersion: 1 } }
    )

    // Move the keyboard selection down onto the ask row.
    act(() => {
      result.current.handleKeyDown({
        key: 'ArrowDown',
        preventDefault: () => {},
      } as KeyboardEvent<HTMLInputElement>)
    })
    expect(result.current.selectedIndex).toBe(0)

    // Ask a question — the answer panel opens (status leaves 'idle').
    act(() => {
      result.current.triggerAsk()
    })
    await waitFor(() => expect(result.current.askAiState.status).toBe('done'))
    expect(result.current.answerOpen).toBe(true)

    // The visitor's session changes (identify/logout): the previous
    // visitor's answer and citations must not carry over, and the keyboard
    // selection returns to nothing-selected.
    rerender({ sessionVersion: 2 })

    expect(result.current.askAiState.status).toBe('idle')
    expect(result.current.answerOpen).toBe(false)
    expect(result.current.selectedIndex).toBe(-1)
  })

  it('does not reset an idle, unselected controller when the session changes (non-interference) (W6, W7)', () => {
    const { result, rerender } = renderHook(
      (props: { sessionVersion: number }) =>
        useAskAiSearchController(controllerProps({ sessionVersion: props.sessionVersion })),
      { initialProps: { sessionVersion: 1 } }
    )

    expect(result.current.askAiState.status).toBe('idle')
    expect(result.current.selectedIndex).toBe(-1)

    rerender({ sessionVersion: 2 })

    expect(result.current.askAiState.status).toBe('idle')
    expect(result.current.selectedIndex).toBe(-1)
  })
})
