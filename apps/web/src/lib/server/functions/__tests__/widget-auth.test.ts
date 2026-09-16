import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock getRequestHeaders before importing the module under test
const mockGet = vi.fn()
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => ({ get: mockGet }),
}))

// Mock db
const mockSessionFindFirst = vi.fn()
const mockPrincipalFindFirst = vi.fn()
const mockInsert = vi.fn()
const mockReturning = vi.fn()
const mockValues = vi.fn(() => {
  const chain = { returning: mockReturning, onConflictDoNothing: () => chain }
  return chain
})

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      session: { findFirst: (...args: unknown[]) => mockSessionFindFirst(...args) },
      principal: { findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args) },
    },
    insert: (...args: unknown[]) => {
      mockInsert(...args)
      return { values: mockValues }
    },
  },
  session: { token: 'token', expiresAt: 'expiresAt', userId: 'userId' },
  principal: { userId: 'userId' },
  eq: vi.fn(),
  and: vi.fn(),
  gt: vi.fn(),
}))

vi.mock('@quackback/ids', () => ({
  generateId: vi.fn(() => 'principal_mock123'),
}))

// Mock workspace settings
vi.mock('@/lib/server/functions/workspace', () => ({
  getSettings: vi.fn(() => ({
    id: 'ws_123',
    slug: 'acme',
    name: 'Acme Inc',
  })),
}))

vi.mock('@/lib/server/storage/s3', () => ({
  getPublicUrlOrNull: vi.fn((key: string | null | undefined) =>
    key ? `https://cdn.example/${key}` : null
  ),
}))

import { getWidgetSession } from '../widget-auth'

describe('getWidgetSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null when no Authorization header', async () => {
    mockGet.mockReturnValue(null)

    const result = await getWidgetSession()
    expect(result).toBeNull()
  })

  it('should return null when Authorization header is not Bearer', async () => {
    mockGet.mockReturnValue('Basic abc123')

    const result = await getWidgetSession()
    expect(result).toBeNull()
  })

  it('should return null when token is empty after Bearer', async () => {
    mockGet.mockReturnValue('Bearer ')

    const result = await getWidgetSession()
    expect(result).toBeNull()
  })

  it('should return null when session not found', async () => {
    mockGet.mockReturnValue('Bearer valid-token-123')
    mockSessionFindFirst.mockResolvedValue(null)

    const result = await getWidgetSession()
    expect(result).toBeNull()
  })

  it('should return null when session has no user', async () => {
    mockGet.mockReturnValue('Bearer valid-token-123')
    mockSessionFindFirst.mockResolvedValue({ userId: 'user_1', user: null })

    const result = await getWidgetSession()
    expect(result).toBeNull()
  })

  it('normalizes the signed bearer form to the raw token for the lookup', async () => {
    // The auth library's set-auth-token header carries `<token>.<signature>`;
    // the DB stores the raw token, so the lookup must use the prefix.
    mockGet.mockReturnValue('Bearer raw-token-123.c2lnbmF0dXJl')
    mockSessionFindFirst.mockResolvedValue({
      userId: 'user_1',
      user: { id: 'user_1', email: 'jane@acme.com', name: 'Jane', image: null },
    })
    mockPrincipalFindFirst.mockResolvedValue({
      id: 'principal_1',
      role: 'user',
      type: 'anonymous',
    })

    const result = await getWidgetSession()

    const { eq } = await import('@/lib/server/db')
    expect(eq).toHaveBeenCalledWith('token', 'raw-token-123')
    expect(result).not.toBeNull()
  })

  it('should return auth context for valid session with existing principal', async () => {
    mockGet.mockReturnValue('Bearer valid-token-123')
    mockSessionFindFirst.mockResolvedValue({
      userId: 'user_1',
      user: { id: 'user_1', email: 'jane@acme.com', name: 'Jane', image: 'https://avatar.url' },
    })
    mockPrincipalFindFirst.mockResolvedValue({
      id: 'principal_1',
      role: 'user',
      type: 'user',
    })

    const result = await getWidgetSession()

    expect(result).toEqual({
      settings: { id: 'ws_123', slug: 'acme', name: 'Acme Inc' },
      user: { id: 'user_1', email: 'jane@acme.com', name: 'Jane', image: 'https://avatar.url' },
      principal: { id: 'principal_1', role: 'user', type: 'user' },
    })
  })

  it('should auto-create principal when none exists', async () => {
    mockGet.mockReturnValue('Bearer valid-token-123')
    mockSessionFindFirst.mockResolvedValue({
      userId: 'user_1',
      user: { id: 'user_1', email: 'jane@acme.com', name: 'Jane', image: null },
    })
    mockPrincipalFindFirst.mockResolvedValue(null)
    mockReturning.mockResolvedValue([{ id: 'principal_mock123', role: 'user' }])

    const result = await getWidgetSession()

    expect(mockInsert).toHaveBeenCalled()
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'principal_mock123',
        userId: 'user_1',
        role: 'user',
        displayName: 'Jane',
        avatarUrl: null,
      })
    )
    expect(result).toEqual({
      settings: { id: 'ws_123', slug: 'acme', name: 'Acme Inc' },
      user: { id: 'user_1', email: 'jane@acme.com', name: 'Jane', image: null },
      principal: { id: 'principal_mock123', role: 'user', type: 'user' },
    })
  })

  it('should handle null image gracefully', async () => {
    mockGet.mockReturnValue('Bearer valid-token-123')
    mockSessionFindFirst.mockResolvedValue({
      userId: 'user_1',
      scope: 'dashboard',
      user: { id: 'user_1', email: 'test@test.com', name: 'Test', image: null },
    })
    mockPrincipalFindFirst.mockResolvedValue({
      id: 'principal_1',
      role: 'member',
      type: 'user',
    })

    const result = await getWidgetSession()

    expect(result?.user.image).toBeNull()
    expect(result?.principal.role).toBe('member')
    expect(result?.principal.type).toBe('user')
  })

  it('presents a promoted principal as an ordinary user on a widget session (R2, R3)', async () => {
    // The session record is the widget's own, and the principal behind it has
    // since been made a teammate. The bearer path must not hand that role back:
    // the audience decides, not the principal row. Contract R2 and R3; the
    // confirmed list is in functions/__tests__/auth-scope.test.ts.
    mockGet.mockReturnValue('Bearer valid-token-123')
    mockSessionFindFirst.mockResolvedValue({
      userId: 'user_1',
      scope: 'widget',
      user: { id: 'user_1', email: 'test@test.com', name: 'Test', image: null },
    })
    mockPrincipalFindFirst.mockResolvedValue({ id: 'principal_1', role: 'member', type: 'user' })

    const result = await getWidgetSession()

    expect(result?.principal.role).toBe('user')
  })

  it('presents the same principal as an ordinary user on a portal session (R2)', async () => {
    mockGet.mockReturnValue('Bearer valid-token-123')
    mockSessionFindFirst.mockResolvedValue({
      userId: 'user_1',
      scope: 'portal',
      user: { id: 'user_1', email: 'test@test.com', name: 'Test', image: null },
    })
    mockPrincipalFindFirst.mockResolvedValue({ id: 'principal_1', role: 'admin', type: 'user' })

    const result = await getWidgetSession()

    expect(result?.principal.role).toBe('user')
  })

  it('refuses a team role to a session record carrying no audience at all (R12)', async () => {
    // A row written by something that does not know about the column. Upstream
    // reads it as a dashboard session and hands back 'admin'.
    mockGet.mockReturnValue('Bearer valid-token-123')
    mockSessionFindFirst.mockResolvedValue({
      userId: 'user_1',
      user: { id: 'user_1', email: 'test@test.com', name: 'Test', image: null },
    })
    mockPrincipalFindFirst.mockResolvedValue({ id: 'principal_1', role: 'admin', type: 'user' })

    const result = await getWidgetSession()

    expect(result?.principal.role).toBe('user')
  })

  it('resolves an uploaded imageKey when user.image is null', async () => {
    mockGet.mockReturnValue('Bearer valid-token-123')
    mockSessionFindFirst.mockResolvedValue({
      userId: 'user_1',
      user: {
        id: 'user_1',
        email: 'test@test.com',
        name: 'Test',
        image: null,
        imageKey: 'avatars/me.png',
      },
    })
    mockPrincipalFindFirst.mockResolvedValue({
      id: 'principal_1',
      role: 'member',
      type: 'user',
    })

    const result = await getWidgetSession()

    expect(result?.user.image).toBe('https://cdn.example/avatars/me.png')
  })
})
