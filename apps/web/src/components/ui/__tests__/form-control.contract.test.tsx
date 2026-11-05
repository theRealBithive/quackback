// @vitest-environment happy-dom
/**
 * FormControl and the rich-text editor behind it.
 *
 * Contract (confirmed 2026-11-05):
 *   E1 Text a person sees in the editor of an admin form (post, changelog,
 *      help-center article; create and edit) arrives as the content: visible
 *      text is never validated or saved as empty.
 *   E2 A field inside FormControl receives the same handlers with the same
 *      arguments as without it; FormControl only adds id, aria-describedby,
 *      aria-invalid and data-slot.
 *   E3 An editor whose owner does not ask for Markdown is still not serialised
 *      to Markdown on every keystroke.
 *   E4 Whoever opens a saved article, post or changelog entry for editing sees
 *      its saved content, however the page was reached, and the form has no
 *      unsaved changes until the person changes something.
 *   E5 A post can be created and saved without a description; an editor
 *      nobody typed in never makes the server reject the submit.
 *
 * E4 failed on a hard load of the help-center article editor: TipTap's
 * `setEditable` emits an `update` by default, the editor emitted it while it
 * still held the empty document, and the form took that as an edit — the body
 * vanished and "Save changes" would have stored it empty.
 * The four admin forms (post, changelog, help-center create and the article
 * editor) all mount `RichTextEditor` as `FormField` → `FormControl` →
 * `RichTextEditor` with a three-argument `onChange` that copies the Markdown
 * into the form. E1 is tested on exactly that arrangement; the help-center and
 * changelog e2e specs drive two of the real forms end to end.
 *
 * E5 follows from E4: an editor that no longer reports an update on mount
 * leaves its document null, and the post forms sent that null to schemas that
 * take an absent body only. It is tested at each form that sends one:
 * `create-post-dialog.test.tsx`, `edit-post-dialog.test.tsx`,
 * `post-modal-metadata-wiring.test.tsx` and `feedback-header-animated.test.tsx`.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, render, act } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { useForm } from 'react-hook-form'
import fc from 'fast-check'
import { renderWithIntl } from '@/test/render-with-intl'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { Form, FormControl, FormField, FormItem } from '@/components/ui/form'

afterEach(cleanup)

/** The TipTap editor behind the mounted surface. */
function mountedEditor(): Editor {
  const surface = document.querySelector('.ProseMirror') as (Element & { editor?: Editor }) | null
  if (!surface?.editor) throw new Error('no mounted editor')
  return surface.editor
}

function typeIntoEditor(text: string): void {
  act(() => {
    mountedEditor().commands.insertContent(text)
  })
}

/** A probe control that records every prop it is rendered with. */
function recordingControl(seen: Record<string, unknown>[]) {
  return function RecordingControl(props: Record<string, unknown>) {
    seen.push(props)
    return <input readOnly />
  }
}

function ProbeForm({ children }: { children: (name: 'content') => React.ReactElement }) {
  const form = useForm({ defaultValues: { content: '' } })
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="content"
        render={() => (
          <FormItem>
            <FormControl>{children('content')}</FormControl>
          </FormItem>
        )}
      />
    </Form>
  )
}

describe('FormControl', () => {
  it('passes every handler of its control through as the very same function (E2)', () => {
    const handlerNames = fc.uniqueArray(
      fc.constantFrom('onChange', 'onBlur', 'onFocus', 'onKeyDown', 'onSubmit', 'onClick'),
      { minLength: 1 }
    )
    fc.assert(
      fc.property(handlerNames, (names) => {
        const handlers: Record<string, (a: unknown, b: unknown, c: unknown) => void> = {}
        for (const name of names) {
          handlers[name] = (_a, _b, _c) => {}
        }
        const seen: Record<string, unknown>[] = []
        const Control = recordingControl(seen)

        render(<ProbeForm>{() => <Control {...handlers} />}</ProbeForm>)

        const lastProps = seen.at(-1)!
        for (const name of names) {
          expect(lastProps[name]).toBe(handlers[name])
          expect((lastProps[name] as (...args: unknown[]) => void).length).toBe(3)
        }
        cleanup()
      }),
      { numRuns: 20 }
    )
  })

  it('adds only the field wiring to its control (E2)', () => {
    const seen: Record<string, unknown>[] = []
    const Control = recordingControl(seen)
    const ownProps = { placeholder: 'kept', 'data-own': 'kept' }

    render(<ProbeForm>{() => <Control {...ownProps} />}</ProbeForm>)

    const lastProps = seen.at(-1)!
    const added = Object.keys(lastProps)
      .filter((key) => !(key in ownProps))
      .sort()
    expect(added).toEqual(['aria-describedby', 'aria-invalid', 'data-slot', 'id'])
    expect(lastProps['data-slot']).toBe('form-control')
    expect(lastProps['aria-invalid']).toBe(false)
    expect(lastProps.placeholder).toBe('kept')
    expect(lastProps['data-own']).toBe('kept')
  })
})

describe('RichTextEditor inside FormControl', () => {
  it('hands the Markdown of typed text to a three-argument onChange (E1)', () => {
    const received: string[] = []
    const onChange = (_json: unknown, _html: string, markdown: string) => {
      received.push(markdown)
    }

    renderWithIntl(<ProbeForm>{() => <RichTextEditor value="" onChange={onChange} />}</ProbeForm>)
    typeIntoEditor('Help article body')

    expect(received.length).toBeGreaterThan(0)
    expect(received.at(-1)).toContain('Help article body')
  })

  it('stores visible text in the form field the way the admin forms copy it (E1)', async () => {
    let submitted: { content: string } | undefined

    function AdminLikeForm() {
      const form = useForm({ defaultValues: { content: '' } })
      const copyMarkdown = (_json: unknown, _html: string, markdown: string) => {
        form.setValue('content', markdown, { shouldDirty: true })
      }
      const submit = form.handleSubmit((data) => {
        submitted = data
      })
      return (
        <Form {...form}>
          <form onSubmit={submit}>
            <FormField
              control={form.control}
              name="content"
              render={() => (
                <FormItem>
                  <FormControl>
                    <RichTextEditor value="" onChange={copyMarkdown} />
                  </FormControl>
                </FormItem>
              )}
            />
            <button type="submit">Save</button>
          </form>
        </Form>
      )
    }

    const rendered = renderWithIntl(<AdminLikeForm />)
    typeIntoEditor('Changelog entry body')
    await act(async () => {
      rendered.getByRole('button', { name: 'Save' }).click()
    })

    expect(submitted?.content.trim().length).toBeGreaterThan(0)
    expect(submitted?.content).toContain('Changelog entry body')
  })

  it('does not serialise Markdown for an onChange that takes json and html only (E3)', () => {
    const onChange = vi.fn((_json: unknown, _html: string) => {})

    renderWithIntl(<ProbeForm>{() => <RichTextEditor value="" onChange={onChange} />}</ProbeForm>)
    const getMarkdown = vi.spyOn(mountedEditor(), 'getMarkdown')
    typeIntoEditor('portal comment')

    expect(onChange).toHaveBeenCalled()
    expect(getMarkdown).not.toHaveBeenCalled()
  })
})

describe('RichTextEditor opened on saved content', () => {
  const savedArticle = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Saved article body' }] }],
  }

  it('reports no change on mount, so opening is not an edit (E4)', async () => {
    const onChange = vi.fn((_json: unknown, _html: string, _markdown: string) => {})

    renderWithIntl(<RichTextEditor value={savedArticle} onChange={onChange} />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(document.querySelector('.ProseMirror')?.textContent).toBe('Saved article body')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('leaves an edit form clean and holding the saved body after it opens (E4)', async () => {
    let isDirty: boolean | undefined
    let storedContent: string | undefined

    function EditLikeForm() {
      const form = useForm({ defaultValues: { content: 'Saved article body' } })
      isDirty = form.formState.isDirty
      storedContent = form.getValues('content')
      const copyMarkdown = (_json: unknown, _html: string, markdown: string) => {
        form.setValue('content', markdown, { shouldDirty: true })
      }
      return (
        <Form {...form}>
          <FormField
            control={form.control}
            name="content"
            render={() => (
              <FormItem>
                <FormControl>
                  <RichTextEditor value={savedArticle} onChange={copyMarkdown} />
                </FormControl>
              </FormItem>
            )}
          />
        </Form>
      )
    }

    renderWithIntl(<EditLikeForm />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(document.querySelector('.ProseMirror')?.textContent).toBe('Saved article body')
    expect(isDirty).toBe(false)
    expect(storedContent).toBe('Saved article body')
  })

  it('still reports the first real edit after opening (E4)', () => {
    const onChange = vi.fn((_json: unknown, _html: string, _markdown: string) => {})

    renderWithIntl(<RichTextEditor value={savedArticle} onChange={onChange} />)
    typeIntoEditor(' plus an edit')

    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls.at(-1)?.[2]).toContain('plus an edit')
  })
})
