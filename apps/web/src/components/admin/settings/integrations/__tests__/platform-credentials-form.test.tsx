// @vitest-environment happy-dom
/**
 * <PlatformCredentialsForm> — what "Update" does to values already saved.
 *
 * Contract
 *
 *   V4  Editing the platform credentials loses no already-saved, non-secret
 *       value that the admin did not touch.
 *   V5  A secret is never prefilled; it has to be entered again deliberately.
 *
 * The bug this pins: "Update" emptied the whole form and only sent what was
 * retyped, while the server drops blank optional fields. Rotating a GitLab
 * client secret therefore silently discarded the self-hosted instance URL and
 * sent the integration back to gitlab.com.
 *
 * Non-secret values are safe to prefill: the read view already displays them
 * in full (only `sensitive` fields come back masked), so nothing is revealed
 * that was not on screen a moment earlier.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { PlatformCredentialsForm } from '../platform-credentials-form'
import type { PlatformCredentialField } from '@/lib/shared/integration-types'

const INSTANCE_URL = 'https://gitlab.self-hosted.example'
const CLIENT_ID = 'application-id-1234'
const MASKED_SECRET = '****cdef'

const saveMutation = { mutate: vi.fn(), isPending: false, isError: false, error: null }
const deleteMutation = { mutate: vi.fn(), isPending: false, isError: false, error: null }

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: () => ({
    data: {
      configured: true,
      managed: false,
      fields: { instanceUrl: INSTANCE_URL, clientId: CLIENT_ID, clientSecret: MASKED_SECRET },
    },
  }),
}))

vi.mock('@/lib/client/mutations', () => ({
  useSavePlatformCredentials: () => saveMutation,
  useDeletePlatformCredentials: () => deleteMutation,
}))

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: { platformCredentials: () => ({ queryKey: ['platform-credentials'] }) },
}))

const FIELDS: PlatformCredentialField[] = [
  {
    key: 'instanceUrl',
    label: 'GitLab instance URL',
    sensitive: false,
    required: false,
    url: true,
  },
  { key: 'clientId', label: 'Application ID', sensitive: false },
  { key: 'clientSecret', label: 'Secret', sensitive: true },
]

afterEach(() => {
  cleanup()
  saveMutation.mutate.mockClear()
})

function renderAndStartEditing() {
  render(<PlatformCredentialsForm integrationType="gitlab" fields={FIELDS} />)
  fireEvent.click(screen.getByRole('button', { name: 'Update' }))
}

function inputFor(label: string): HTMLInputElement {
  return screen.getByLabelText(new RegExp(label)) as HTMLInputElement
}

describe('PlatformCredentialsForm — Update keeps what it already knows', () => {
  it('prefills the saved instance URL (V4)', () => {
    renderAndStartEditing()

    expect(inputFor('GitLab instance URL').value).toBe(INSTANCE_URL)
  })

  it('prefills the saved application id (V4)', () => {
    renderAndStartEditing()

    expect(inputFor('Application ID').value).toBe(CLIENT_ID)
  })

  it('leaves the secret empty rather than seeding it with the mask (V5)', () => {
    renderAndStartEditing()

    expect(inputFor('Secret').value).toBe('')
  })

  it('sends the untouched instance URL along when only the secret is rotated (V4)', () => {
    renderAndStartEditing()

    fireEvent.change(inputFor('Secret'), { target: { value: 'new-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(saveMutation.mutate).toHaveBeenCalledTimes(1)
    expect(saveMutation.mutate.mock.calls[0][0]).toEqual({
      integrationType: 'gitlab',
      credentials: {
        instanceUrl: INSTANCE_URL,
        clientId: CLIENT_ID,
        clientSecret: 'new-secret',
      },
    })
  })

  it('lets the admin clear the optional instance URL on purpose (V4)', () => {
    renderAndStartEditing()

    fireEvent.change(inputFor('GitLab instance URL'), { target: { value: '' } })
    fireEvent.change(inputFor('Secret'), { target: { value: 'new-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    const sent = saveMutation.mutate.mock.calls[0][0] as {
      credentials: Record<string, string>
    }
    expect(sent.credentials.instanceUrl).toBe('')
  })

  it('discards the prefill when the edit is cancelled', () => {
    renderAndStartEditing()

    fireEvent.change(inputFor('Application ID'), { target: { value: 'typed-over' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    expect(inputFor('Application ID').value).toBe(CLIENT_ID)
  })
})
