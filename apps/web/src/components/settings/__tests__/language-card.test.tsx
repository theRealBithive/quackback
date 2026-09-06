// @vitest-environment happy-dom
/**
 * The card where a signed-in person chooses the language of the product.
 *
 * Contract (domain language). L2, L3 and L4 are held by
 * `lib/shared/__tests__/language-choice.test.ts`, which owns the list of
 * languages itself; they are repeated here because the card is where they
 * become visible.
 *
 *   L1  A person who picks a language is spoken to in that language from the
 *       next paint on, without signing out and without reloading by hand. (V1, V4)
 *   L2  "Follow my browser" stays available as a choice, not only as the
 *       state someone starts in: a person who has picked a language can give
 *       the choice back to their browser. (V2)
 *   L3  The card offers every language the product is translated into, each
 *       named in that language, so a reader can find their own without
 *       already reading ours. (V3)
 *   L4  A person whose stored language is one the product is not translated
 *       into still finds that language selected when they open the card, and
 *       opening the card does not discard it. (V3)
 *   L5  Before the choice is made, the card says that it decides two things
 *       at once: the language the product speaks, and the language customer
 *       messages are translated into. (V3)
 *   L6  For a language the product is not translated into, the card says
 *       plainly that the interface stays English while customer messages are
 *       still translated into that language. (V3)
 *   L7  Someone with no inbox is told about the interface language only --
 *       the promise about customer messages is not made to a reader it cannot
 *       be kept for. (V3)
 *   L8  The card can only change the language of the person using it: what it
 *       sends names a language and nothing else.
 *   L9  The two things the choice drives never disagree afterwards -- the same
 *       act that changes the interface language refreshes the inbox's idea of
 *       which language this person reads. (V3)
 *   L10 The card sits on the page a person reaches from their own account
 *       menu, beside the other choices they make about themselves. (V4)
 *       Held by `routes/_portal/__tests__/settings.preferences.test.tsx`.
 *   L11 A change that does not reach the server says so, rather than leaving
 *       someone believing they picked a language they did not.
 *
 * L1 is asserted here as "the loaders that carry the catalogue are asked for
 * again", because that is what this router calls the thing: every page's
 * messages come from a loader, and `router.invalidate()` is the whole of
 * re-running them. What a reader then sees is the one part no component test
 * can reach; the manual walkthrough in the plan covers it.
 */
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderWithIntl } from '@/test/render-with-intl'
import { SUPPORTED_LOCALE_LABELS } from '@/lib/shared/language-choice'

const state = {
  stored: null as string | null,
  role: 'admin' as string | null,
  setFails: false,
}

const setLanguage = vi.fn()
const invalidateRouter = vi.fn(async () => undefined)
const invalidateQueries = vi.fn()
const successToast = vi.fn()
const errorToast = vi.fn()

vi.mock('@/lib/server/functions/teammate-preferences', () => ({
  getMyLanguagePreferenceFn: async () => ({ language: state.stored }),
  setMyLanguagePreferenceFn: async (input: { data: { language: string | null } }) => {
    setLanguage(input)
    if (state.setFails) throw new Error('nope')
    return { language: input.data.language }
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({ userRole: state.role }),
  useRouter: () => ({ invalidate: invalidateRouter }),
}))

// Called through, rather than handed over: a `vi.mock` factory is hoisted
// above the `const`s above it, so naming the spies directly here reads them
// before they exist.
vi.mock('sonner', () => ({
  toast: {
    success: (message: string) => successToast(message),
    error: (message: string) => errorToast(message),
  },
}))

// Radix Select needs pointer and layout APIs happy-dom lacks; rendered as a
// native <select> the picker is drivable with fireEvent.change. The accessible
// name is pinned here rather than read from the trigger, the same compromise
// the other Select suites in this repository make.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string
    onValueChange: (v: string) => void
    disabled?: boolean
    children: ReactNode
  }) => (
    <select
      aria-label="Interface language"
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))

import { LanguageCard } from '../language-card'

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.invalidateQueries = invalidateQueries.mockResolvedValue(undefined)
  return renderWithIntl(
    <QueryClientProvider client={queryClient}>
      <LanguageCard />
    </QueryClientProvider>
  )
}

/** The picker, once the stored preference has arrived. */
async function picker(): Promise<HTMLSelectElement> {
  const select = (await screen.findByRole('combobox', {
    name: 'Interface language',
  })) as HTMLSelectElement
  await vi.waitFor(() => expect(select).not.toBeDisabled())
  return select
}

beforeEach(() => {
  state.stored = null
  state.role = 'admin'
  state.setFails = false
})

afterEach(() => {
  cleanup()
  setLanguage.mockReset()
  invalidateRouter.mockClear()
  invalidateQueries.mockReset()
  successToast.mockReset()
  errorToast.mockReset()
})

describe('choosing the language of the product', () => {
  it('offers every language the product ships, named in itself (L3)', async () => {
    renderCard()
    await picker()

    for (const label of Object.values(SUPPORTED_LOCALE_LABELS)) {
      expect(screen.getByRole('option', { name: label })).toBeInTheDocument()
    }
  })

  it('offers giving the choice back to the browser (L2)', async () => {
    state.stored = 'de'
    renderCard()

    expect(screen.getByRole('option', { name: 'Follow my browser' })).toBeInTheDocument()
    expect(await picker()).toHaveValue('de')
  })

  it('stores nothing at all when the browser choice is picked (L2, L8)', async () => {
    state.stored = 'de'
    renderCard()

    fireEvent.change(await picker(), { target: { value: '__browser__' } })

    await vi.waitFor(() => expect(setLanguage).toHaveBeenCalledTimes(1))
    expect(setLanguage.mock.calls[0][0]).toEqual({ data: { language: null } })
  })

  it('starts on the browser choice when nothing is stored (L2)', async () => {
    renderCard()

    expect(await picker()).toHaveValue('__browser__')
  })

  it('sends the picked language and nothing else (L8)', async () => {
    renderCard()

    fireEvent.change(await picker(), { target: { value: 'de' } })

    await vi.waitFor(() => expect(setLanguage).toHaveBeenCalledTimes(1))
    expect(setLanguage.mock.calls[0][0]).toEqual({ data: { language: 'de' } })
  })

  it('asks for the pages carrying the catalogue again, without a reload (L1)', async () => {
    renderCard()

    fireEvent.change(await picker(), { target: { value: 'fr' } })

    await vi.waitFor(() => expect(invalidateRouter).toHaveBeenCalledTimes(1))
    expect(successToast).toHaveBeenCalledTimes(1)
  })

  it('refreshes what the inbox believes this person reads (L9)', async () => {
    renderCard()

    fireEvent.change(await picker(), { target: { value: 'fr' } })

    await vi.waitFor(() => expect(invalidateQueries).toHaveBeenCalled())
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['teammate', 'language-preference'],
    })
  })

  it('says so when the change does not reach the server (L11)', async () => {
    state.setFails = true
    renderCard()

    fireEvent.change(await picker(), { target: { value: 'fr' } })

    await vi.waitFor(() => expect(errorToast).toHaveBeenCalledTimes(1))
    expect(successToast).not.toHaveBeenCalled()
    expect(invalidateRouter).not.toHaveBeenCalled()
  })
})

describe('a language the product does not speak', () => {
  it('keeps it selected and names it (L4)', async () => {
    state.stored = 'ja'
    renderCard()

    expect(await picker()).toHaveValue('ja')
    expect(screen.getByRole('option', { name: 'Japanese' })).toBeInTheDocument()
  })

  it('says the interface stays English while messages are still translated (L6)', async () => {
    state.stored = 'ja'
    renderCard()
    await picker()

    expect(
      screen.getByText(
        'We have not translated the app into Japanese yet, so the interface stays in English. Customer messages are still translated into Japanese.'
      )
    ).toBeInTheDocument()
  })

  it('says nothing of the sort for a language we do ship (L6)', async () => {
    state.stored = 'de'
    renderCard()
    await picker()

    expect(screen.queryByText(/stays in English/)).not.toBeInTheDocument()
  })
})

describe('what the card promises whom', () => {
  it('tells a teammate the choice drives both things (L5)', async () => {
    renderCard()
    await picker()

    expect(
      screen.getByText(
        'The language the app speaks to you in. Customer messages in your inbox are translated into it too.'
      )
    ).toBeInTheDocument()
  })

  it('promises someone with no inbox only the interface language (L7)', async () => {
    state.role = 'user'
    renderCard()
    await picker()

    expect(screen.getByText('The language the app speaks to you in.')).toBeInTheDocument()
    expect(screen.queryByText(/Customer messages/)).not.toBeInTheDocument()
  })

  it('leaves the inbox half out of the note as well (L7)', async () => {
    state.role = 'user'
    state.stored = 'ja'
    renderCard()
    await picker()

    expect(
      screen.getByText(
        'We have not translated the app into Japanese yet, so the interface stays in English.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/still translated/)).not.toBeInTheDocument()
  })
})
