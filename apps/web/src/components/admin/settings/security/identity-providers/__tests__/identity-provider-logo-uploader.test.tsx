// @vitest-environment happy-dom
/**
 * `<IdentityProviderLogoUploader>` — file-picker validation, the crop step,
 * and the Remove control. `useProviderLogo` is mocked so these tests only
 * exercise the uploader's own wiring: which files are rejected before the
 * cropper ever opens, that the picked file's object URL is revoked exactly
 * once (on crop-complete and on an unsaved close), and that Remove only
 * exists — and only does something — when there is a logo to remove.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { IdentityProviderId } from '@quackback/ids'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { IdentityProviderLogoUploader } from '../identity-provider-logo-uploader'

const { uploadSpy, removeSpy, mockUseProviderLogo } = vi.hoisted(() => ({
  uploadSpy: vi.fn(async (_blob: Blob) => true),
  removeSpy: vi.fn(async () => true),
  mockUseProviderLogo: vi.fn(),
}))

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }))

vi.mock('../use-provider-logo', () => ({ useProviderLogo: mockUseProviderLogo }))

// A stub that exposes the two moves the real cropper offers: applying a crop
// (calls onCropComplete with a Blob) and closing without saving (calls
// onOpenChange(false)) — enough to drive the uploader through both paths.
vi.mock('@/components/ui/image-cropper', () => ({
  ImageCropper: ({
    open,
    onCropComplete,
    onOpenChange,
  }: {
    open: boolean
    onCropComplete: (blob: Blob) => void
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div>
        <button
          type="button"
          onClick={() => onCropComplete(new Blob(['cropped'], { type: 'image/png' }))}
        >
          Apply crop
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close cropper
        </button>
      </div>
    ) : null,
}))

function makeProvider(over: Partial<IdentityProvider> = {}): IdentityProvider {
  return {
    id: 'idp_x' as IdentityProviderId,
    registrationId: 'oidc_x',
    label: 'Acme SSO',
    kind: null,
    configured: true,
    discoveryUrl: null,
    authorizationUrl: null,
    tokenUrl: null,
    userInfoUrl: null,
    jwksUri: null,
    issuer: null,
    clientId: 'client-id',
    scopes: null,
    prompt: null,
    tokenEndpointAuthMethod: null,
    enabled: true,
    autoCreateUsers: true,
    autoProvisionRole: 'user',
    claimMapping: null,
    showButton: false,
    logoKey: null,
    logoUrl: null,
    detailsChangedAt: null,
    lastSuccessfulTestAt: null,
    lastTestCapture: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    domains: [],
    visibility: 'button',
    ...over,
  }
}

const createObjectURLMock = vi.fn(() => 'blob:mock-url')
const revokeObjectURLMock = vi.fn()

function selectFile(file: File) {
  // The file input is visually hidden and unlabelled (the visible control is
  // the avatar tile button, which only opens the OS picker); it is reached
  // directly rather than through a role or label query.
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
}

function pngFile(sizeBytes = 1024) {
  const file = new File(['x'], 'logo.png', { type: 'image/png' })
  Object.defineProperty(file, 'size', { value: sizeBytes })
  return file
}

beforeEach(() => {
  uploadSpy.mockClear()
  removeSpy.mockClear()
  toastError.mockClear()
  createObjectURLMock.mockClear()
  revokeObjectURLMock.mockClear()
  URL.createObjectURL = createObjectURLMock
  URL.revokeObjectURL = revokeObjectURLMock
  mockUseProviderLogo.mockReturnValue({
    uploading: false,
    removing: false,
    upload: uploadSpy,
    remove: removeSpy,
  })
})

describe('<IdentityProviderLogoUploader> avatar tile', () => {
  it('opens the OS file picker when the avatar tile is clicked', () => {
    render(<IdentityProviderLogoUploader provider={makeProvider()} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {})

    fireEvent.click(screen.getByRole('button', { name: 'Change provider logo' }))

    expect(clickSpy).toHaveBeenCalledTimes(1)
  })
})

describe('<IdentityProviderLogoUploader> file validation', () => {
  it('rejects a disallowed file type before ever opening the cropper', () => {
    render(<IdentityProviderLogoUploader provider={makeProvider()} />)
    const pdf = new File(['x'], 'logo.pdf', { type: 'application/pdf' })
    selectFile(pdf)

    expect(toastError).toHaveBeenCalledWith('Invalid file type. Allowed: JPEG, PNG, GIF, WebP')
    expect(createObjectURLMock).not.toHaveBeenCalled()
    expect(screen.queryByText('Apply crop')).not.toBeInTheDocument()
  })

  it('rejects a file over the 5MB limit before ever opening the cropper', () => {
    render(<IdentityProviderLogoUploader provider={makeProvider()} />)
    const tooBig = pngFile(5 * 1024 * 1024 + 1)
    selectFile(tooBig)

    expect(toastError).toHaveBeenCalledWith('File too large. Maximum size is 5MB')
    expect(createObjectURLMock).not.toHaveBeenCalled()
    expect(screen.queryByText('Apply crop')).not.toBeInTheDocument()
  })

  it('opens the cropper on an object URL for a valid file', () => {
    render(<IdentityProviderLogoUploader provider={makeProvider()} />)
    selectFile(pngFile())

    expect(createObjectURLMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Apply crop')).toBeInTheDocument()
    expect(toastError).not.toHaveBeenCalled()
  })
})

describe('<IdentityProviderLogoUploader> crop step', () => {
  it('uploads the cropped blob and revokes the picked file object URL on crop complete', () => {
    render(<IdentityProviderLogoUploader provider={makeProvider()} />)
    selectFile(pngFile())

    fireEvent.click(screen.getByText('Apply crop'))

    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-url')
    expect(uploadSpy).toHaveBeenCalledTimes(1)
    expect(uploadSpy.mock.calls[0][0]).toBeInstanceOf(Blob)
  })

  it('revokes the picked file object URL and uploads nothing when the cropper is closed unsaved', () => {
    render(<IdentityProviderLogoUploader provider={makeProvider()} />)
    selectFile(pngFile())

    fireEvent.click(screen.getByText('Close cropper'))

    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-url')
    expect(uploadSpy).not.toHaveBeenCalled()
  })
})

describe('<IdentityProviderLogoUploader> Remove', () => {
  it('offers no Remove control when the provider has no logo', () => {
    render(<IdentityProviderLogoUploader provider={makeProvider({ logoUrl: null })} />)
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
  })

  it('removes the logo on click when one is set', () => {
    render(
      <IdentityProviderLogoUploader
        provider={makeProvider({ logoUrl: 'https://cdn.example.com/logo.png' })}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(removeSpy).toHaveBeenCalledTimes(1)
  })

  it('shows a removing state and disables the control while the removal is in flight', () => {
    mockUseProviderLogo.mockReturnValue({
      uploading: false,
      removing: true,
      upload: uploadSpy,
      remove: removeSpy,
    })
    render(
      <IdentityProviderLogoUploader
        provider={makeProvider({ logoUrl: 'https://cdn.example.com/logo.png' })}
      />
    )
    const button = screen.getByRole('button', { name: 'Removing…' })
    expect(button).toBeDisabled()
  })
})
