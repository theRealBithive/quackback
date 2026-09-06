// @vitest-environment happy-dom
/**
 * The copy the onboarding wizard shows, in the language the request resolved.
 *
 * From the confirmed contract:
 *
 *   V5 The language a page declares to a browser or a screen reader is always
 *      the language its text is actually written in.
 *   V7 Every language we offer answers for every string the interface can
 *      show, so switching language never empties a page.
 *
 * `document-lang.test.tsx` holds the declaring half of V5 for this route. It
 * cannot see the other half: a document may honestly say `lang="de"` and still
 * carry an English heading a `FormattedMessage` never reached. That is what
 * this suite measures, and it measures it in German on purpose -- under `en`
 * a string that never reaches the catalogue renders identically to one that
 * does, so an English assertion cannot tell the two apart.
 *
 * The expected text is read back from `de.json` rather than repeated here, so
 * a reworded translation moves the test with it.
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { ReactElement } from 'react'
import deMessages from '@/locales/de.json'
import enMessages from '@/locales/en.json'
import { buildLaunchTasks, type LaunchTask } from '@/lib/shared/launch-checklist'
import { CloudUseCaseForm } from '../_layout.usecase'
import { CloudIdentityUnavailable, CloudWorkspaceDetailsForm } from '../_layout.workspace'
import { BridgeDescription, LaunchPreview } from '../_layout.complete'

const german = deMessages as Record<string, string>
const english = enMessages as Record<string, string>

const IDENTITY = {
  version: 1,
  displayName: 'Untitled workspace',
  canonicalOrigin: 'https://ws-a1b2c3.quackback.co.uk',
  platformHostname: null,
  customDomains: [],
  updatedAt: '2026-08-14T12:00:00.000Z',
}

/** A task the preview renders as blocked, which is the only state that shows
 *  the badge this suite is about. Built here rather than at module scope: a
 *  mutant that crashes a fixture during collection is reported as survived. */
function blockedTask(): LaunchTask {
  return {
    id: 'connect-messenger',
    title: 'Connect Messenger',
    description: 'Put the Messenger where your customers already are.',
    availability: 'blocked',
    classification: 'first_win',
    isCompleted: false,
    isSkipped: false,
    completedLabel: 'Connected',
  }
}

/** Renders under the shipped German catalogue, failing on any intl error --
 *  a placeholder the caller never supplied would otherwise be a console line
 *  nobody reads. `renderWithIntl` deliberately provides English only. */
function renderInGerman(ui: ReactElement) {
  return render(
    <IntlProvider
      locale="de"
      defaultLocale="en"
      messages={german}
      onError={(error) => {
        throw error
      }}
    >
      {ui}
    </IntlProvider>
  )
}

/**
 * The German a shipped catalogue answers with, proven to be a translation
 * rather than the English original carried over.
 *
 * Only for the ids this batch authors. It is deliberately not the helper for
 * every id: a German entry identical to its English one is normal for a
 * loanword -- 437 of this catalogue's entries are that by design -- so the
 * check would be a rule against words German and English happen to share, and
 * the way to satisfy it would be to reword good German. {@link catalogued} is
 * the one for ids that were already there.
 */
function translated(id: string): string {
  const text = catalogued(id)
  expect(text, `de.json still carries the English for ${id}`).not.toBe(english[id])
  return text
}

/** The German a shipped catalogue answers with, whatever it reads. */
function catalogued(id: string): string {
  const text = german[id]
  expect(text, `de.json has no entry for ${id}`).toBeTruthy()
  return text
}

afterEach(cleanup)

describe('the onboarding wizard in German', () => {
  it('translates the cloud workspace form, labels and placeholder included (V5, V7)', () => {
    renderInGerman(<CloudWorkspaceDetailsForm identity={IDENTITY} onSave={async () => {}} />)

    expect(
      screen.getByRole('heading', { name: translated('onboarding.cloudWorkspace.title') })
    ).toBeInTheDocument()
    expect(
      screen.getByText(translated('onboarding.cloudWorkspace.description'))
    ).toBeInTheDocument()
    expect(screen.getByLabelText(catalogued('onboarding.workspace.name'))).toBeInTheDocument()

    const url = screen.getByLabelText(translated('onboarding.cloudWorkspace.urlLabel'))
    expect(url).toHaveAttribute(
      'placeholder',
      translated('onboarding.cloudWorkspace.urlPlaceholder')
    )
  })

  it('translates the screen shown when the cloud identity has not arrived (V5, V7)', () => {
    renderInGerman(<CloudIdentityUnavailable />)

    expect(
      screen.getByRole('heading', { name: translated('onboarding.cloudIdentity.title') })
    ).toBeInTheDocument()
    expect(screen.getByText(translated('onboarding.cloudIdentity.description'))).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: translated('onboarding.cloudIdentity.retry') })
    ).toBeInTheDocument()
  })

  it('translates the goal screen a cloud workspace is sent to (V5, V7)', () => {
    renderInGerman(<CloudUseCaseForm onSave={async () => {}} />)

    expect(
      screen.getByRole('heading', { name: translated('onboarding.usecase.title') })
    ).toBeInTheDocument()
    expect(screen.getByText(translated('onboarding.usecase.description'))).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: catalogued('onboarding.continue') })
    ).toBeInTheDocument()
  })

  it('falls back to its own German message when saving a goal fails (V5, V7)', async () => {
    // The one string on this screen a reader only ever sees on a bad day, and
    // the one no render alone reaches: it is the fallback for a rejection that
    // carries no message of its own.
    renderInGerman(<CloudUseCaseForm onSave={() => Promise.reject('no message')} />)

    fireEvent.click(
      screen.getByRole('radio', {
        name: new RegExp(translated('onboarding.goal.product_feedback.label')),
      })
    )
    fireEvent.click(screen.getByRole('button', { name: catalogued('onboarding.continue') }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      translated('onboarding.usecase.saveFailed')
    )
  })

  it('prefers what the failure itself says over the fallback (V6)', async () => {
    // Same branch, other side. Without this the fallback would satisfy the
    // test whether or not the code ever looks at the cause.
    renderInGerman(
      <CloudUseCaseForm onSave={() => Promise.reject(new Error('Das Ziel ist belegt.'))} />
    )

    fireEvent.click(
      screen.getByRole('radio', {
        name: new RegExp(translated('onboarding.goal.product_feedback.label')),
      })
    )
    fireEvent.click(screen.getByRole('button', { name: catalogued('onboarding.continue') }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Das Ziel ist belegt.')
  })

  it('translates the launch preview, badge and screen-reader marks alike (V5, V7)', () => {
    renderInGerman(<LaunchPreview tasks={[blockedTask()]} outcome="customer_support" />)

    expect(screen.getByText(translated('onboarding.bridge.needsAttention'))).toBeInTheDocument()
    // The marks carry no visible text at all -- their whole content is the
    // label a screen reader announces, which is exactly the kind of string a
    // sweep for visible English never finds.
    expect(screen.getByLabelText(translated('onboarding.bridge.mark.next'))).toBeInTheDocument()
  })

  it('translates the task names in the launch preview (V5, V7)', () => {
    // The names arrive as English props out of `launch-checklist.ts`, which is
    // the fallback source and stays English on purpose. A prop is invisible to
    // a sweep for raw strings and does not change when the catalogue does, so
    // the rendered text is the only thing that can tell the two apart.
    const tasks = buildLaunchTasks(
      { hasBoards: false, memberCount: 1, hasBranding: false },
      'internal'
    )
    expect(tasks.length).toBeGreaterThan(0)

    renderInGerman(<LaunchPreview tasks={tasks} outcome="internal" />)

    for (const task of tasks) {
      const name = translated(`activation.task.internal.${task.id}.title`)
      expect(screen.getByText(name)).toBeInTheDocument()
      expect(
        screen.queryByText(task.title),
        `the English name for ${task.id} is still on the page`
      ).toBeNull()
    }
  })

  it('translates the goal it reads into the opening sentence (V5, V7)', () => {
    // The goal is a value inside a message rather than a message of its own,
    // so it renders in the middle of a German line. An English word there
    // reads as a product name and is the easiest kind to walk past.
    renderInGerman(<BridgeDescription outcome="customer_support" />)

    const goal = translated('activation.goal.customer_support')
    const sentence = catalogued('onboarding.bridge.description').replace('{goal}', goal)

    expect(screen.getByText(sentence)).toBeInTheDocument()
    expect(screen.queryByText(/Customer support/)).toBeNull()
  })

  it('marks a done and a later task for a screen reader, in German (V5, V7)', () => {
    // Real task ids of this goal, because the names now resolve through the
    // catalogue: an invented id would render its English fallback and the
    // provider would report the missing translation as a failure.
    const done = {
      ...blockedTask(),
      id: 'invite-team',
      isCompleted: true,
      availability: 'complete' as const,
    }
    const later = {
      ...blockedTask(),
      id: 'customize-branding',
      availability: 'available' as const,
    }

    renderInGerman(
      <LaunchPreview tasks={[done, blockedTask(), later]} outcome="customer_support" />
    )

    expect(screen.getByLabelText(translated('onboarding.bridge.mark.done'))).toBeInTheDocument()
    expect(screen.getByLabelText(translated('onboarding.bridge.mark.later'))).toBeInTheDocument()
  })
})
