// @vitest-environment happy-dom
/**
 * ## P — Widget install pairing (upstream 98b18e3ee)
 * - P1 The install prompt an admin copies carries a short-lived pairing code and
 *   never the signing secret; the code is minted on copy by an admin with
 *   settings.manage, and a mint failure toasts and copies nothing.
 * - P4 The copy-prompt button reads "Copied" for two seconds after a successful
 *   copy, and shows nothing when the copy fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'

const { copyWithFallback } = vi.hoisted(() => ({
  copyWithFallback: vi.fn(),
}))

vi.mock('@/components/admin/activation-action-button', () => ({
  copyWithFallback: (...args: unknown[]) => copyWithFallback(...args),
}))

import { CopyAgentPromptButton } from '../copy-agent-prompt-button'

describe('CopyAgentPromptButton', () => {
  beforeEach(() => {
    copyWithFallback.mockReset()
    copyWithFallback.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves getPrompt on click, copies it, and shows a success label', async () => {
    const getPrompt = vi.fn().mockResolvedValue('prompt with qbi_code')
    render(<CopyAgentPromptButton getPrompt={getPrompt} />)

    const button = screen.getByRole('button', {
      name: 'Copy install prompt for your coding agent',
    })
    expect(screen.getByLabelText('Claude')).toBeTruthy()
    expect(screen.getByLabelText('Cursor')).toBeTruthy()
    expect(screen.getByLabelText('Codex')).toBeTruthy()
    expect(screen.getByLabelText('Copilot')).toBeTruthy()

    fireEvent.click(button)

    await waitFor(() => {
      expect(getPrompt).toHaveBeenCalled()
      expect(copyWithFallback).toHaveBeenCalledWith('prompt with qbi_code')
      expect(screen.getByRole('button', { name: 'Install prompt copied' })).toBeTruthy()
    })
  })

  it('falls back to the idle label two seconds after a successful copy (P4)', async () => {
    vi.useFakeTimers()
    const getPrompt = vi.fn().mockResolvedValue('prompt with qbi_code')
    render(<CopyAgentPromptButton getPrompt={getPrompt} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Copy install prompt for your coding agent' })
    )
    // handleClick awaits getPrompt and copyWithFallback before it flips the label.
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Install prompt copied' })).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999)
    })
    expect(screen.getByRole('button', { name: 'Install prompt copied' })).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(
      screen.getByRole('button', { name: 'Copy install prompt for your coding agent' })
    ).toBeTruthy()
  })

  it('shows nothing when the clipboard refuses the copy (P4)', async () => {
    copyWithFallback.mockRejectedValue(new Error('clipboard denied'))
    const getPrompt = vi.fn().mockResolvedValue('prompt with qbi_code')
    render(<CopyAgentPromptButton getPrompt={getPrompt} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Copy install prompt for your coding agent' })
    )

    await waitFor(() => {
      expect(copyWithFallback).toHaveBeenCalledWith('prompt with qbi_code')
    })
    expect(
      screen.getByRole('button', { name: 'Copy install prompt for your coding agent' })
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install prompt copied' })).toBeNull()
  })

  it('copies nothing when minting the pairing code failed (P1)', async () => {
    // The install page turns a failed mint into an empty prompt; nothing may
    // reach the clipboard and the button must stay in its idle state.
    const getPrompt = vi.fn().mockResolvedValue('')
    render(<CopyAgentPromptButton getPrompt={getPrompt} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Copy install prompt for your coding agent' })
    )

    await waitFor(() => {
      expect(getPrompt).toHaveBeenCalled()
    })
    expect(copyWithFallback).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Install prompt copied' })).toBeNull()
  })
})
