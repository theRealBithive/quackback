/**
 * The dynamic-client-registration budget is a per-workspace resource. Counted
 * process-wide, one address exhausts every workspace's allowance at once — and
 * the refusal it causes elsewhere is indistinguishable from a legitimate one.
 *
 * Only the last test belongs to the batch K contract (upstream #662); the
 * workspace-scoping tests predate it and carry no number from that list.
 *
 *   C2 A client cannot choose its own counting bucket, neither with forwarding
 *      headers nor by sending the internal client-address header itself.
 */
import { describe, it, expect, vi } from 'vitest'

const { mockGetRequestIP } = vi.hoisted(() => ({ mockGetRequestIP: vi.fn() }))
vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  getRequestIP: mockGetRequestIP,
}))

const { isRegistrationRateLimited, REG_MAX } = await import('../$')
const { withWorkspace } = await import('@/lib/server/__tests__/workspace-scope')

/** A registration from socket peer `ip`, carrying whatever headers the client chose. */
function request(ip: string, headers: Record<string, string> = {}): Request {
  mockGetRequestIP.mockReturnValue(ip)
  return new Request('https://app.example.com/api/auth/oauth2/register', {
    method: 'POST',
    headers,
  })
}

/** Spend the whole window for `ip` inside `workspaceKey`. Returns the last verdict. */
function exhaust(workspaceKey: string, ip: string): boolean {
  let limited = false
  withWorkspace(workspaceKey, () => {
    for (let i = 0; i <= REG_MAX; i += 1) limited = isRegistrationRateLimited(request(ip))
  })
  return limited
}

describe('registration rate limit', () => {
  it('does not spend another workspace budget (J30)', () => {
    const ip = '203.0.113.11'

    expect(exhaust('workspace-alpha', ip)).toBe(true)
    expect(withWorkspace('workspace-bravo', () => isRegistrationRateLimited(request(ip)))).toBe(
      false
    )
  })

  it('does not spend the budget in the other direction either', () => {
    const ip = '203.0.113.12'

    expect(exhaust('workspace-bravo', ip)).toBe(true)
    expect(withWorkspace('workspace-alpha', () => isRegistrationRateLimited(request(ip)))).toBe(
      false
    )
  })

  it('leaves an unscoped process unaffected by a workspace exhausting its window', () => {
    const ip = '203.0.113.13'

    expect(exhaust('workspace-alpha', ip)).toBe(true)
    expect(isRegistrationRateLimited(request(ip))).toBe(false)
  })

  it('admits exactly 100 registrations an hour from one address, and refuses the next (J30)', () => {
    const ip = '203.0.113.16'
    const verdicts: boolean[] = []
    withWorkspace('workspace-echo', () => {
      for (let i = 0; i < 101; i += 1) verdicts.push(isRegistrationRateLimited(request(ip)))
    })

    expect(REG_MAX).toBe(100)
    expect(verdicts.slice(0, 100).every((limited) => limited === false)).toBe(true)
    expect(verdicts[100]).toBe(true)
  })

  it('still limits within one workspace (J30)', () => {
    const ip = '203.0.113.14'

    expect(withWorkspace('workspace-charlie', () => isRegistrationRateLimited(request(ip)))).toBe(
      false
    )
    expect(exhaust('workspace-charlie', ip)).toBe(true)
  })

  it('does not let a forwarding header or the private header buy a fresh budget (C2, J30)', () => {
    const ip = '203.0.113.15'

    expect(exhaust('workspace-delta', ip)).toBe(true)
    expect(
      withWorkspace('workspace-delta', () =>
        isRegistrationRateLimited(
          request(ip, {
            'x-forwarded-for': '9.9.9.9',
            'cf-connecting-ip': '9.9.9.8',
            'x-quackback-client-ip': '9.9.9.7',
          })
        )
      )
    ).toBe(true)
  })
})
