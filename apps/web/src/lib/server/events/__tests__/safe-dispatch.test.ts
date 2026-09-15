import { describe, expect, it, vi } from 'vitest'
import { makeSafeDispatch } from '../safe-dispatch'

/**
 * ## W — Webhook dispatch
 * - W1 A webhook or event-bus failure never fails the write that triggered
 *   it: the dispatch resolves, and the failure is logged at warning level
 *   with its label.
 * - W2 A successful dispatch runs exactly once and resolves.
 */

describe('makeSafeDispatch', () => {
  it('swallows a dispatch failure, logs { err, label } with "webhook failed" (W1)', async () => {
    const warn = vi.fn()
    const safe = makeSafeDispatch({ warn })
    const err = new Error('bus down')
    const fn = vi.fn(async () => {
      throw err
    })

    await safe('ticket.created', fn)

    expect(warn).toHaveBeenCalledWith({ err, label: 'ticket.created' }, 'webhook failed')
    expect(fn).toHaveBeenCalledOnce()
  })

  it('resolves the returned promise on failure, rather than rejecting (W1)', async () => {
    const warn = vi.fn()
    const safe = makeSafeDispatch({ warn })

    await expect(
      safe('ticket.created', async () => {
        throw new Error('bus down')
      })
    ).resolves.toBeUndefined()
  })

  it('runs a successful dispatch exactly once, resolves, and logs nothing (W2)', async () => {
    const warn = vi.fn()
    const safe = makeSafeDispatch({ warn })
    const fn = vi.fn().mockResolvedValue(undefined)

    await expect(safe('ticket.created', fn)).resolves.toBeUndefined()

    expect(fn).toHaveBeenCalledOnce()
    expect(warn).not.toHaveBeenCalled()
  })
})
