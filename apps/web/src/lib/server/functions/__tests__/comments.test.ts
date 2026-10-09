import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostCommentId, PrincipalId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'

// --- Mock: capture handlers registered via createServerFn ---

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlersByIndex: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlersByIndex.push(fn)
        return chain
      },
    }
    return chain
  },
}))

// --- Mock: comment service ---

const mockCanEditComment = vi.fn()
const mockCanDeleteComment = vi.fn()
const mockCanPinComment = vi.fn()

vi.mock('@/lib/server/domains/comments/comment.service', () => ({
  createComment: vi.fn(),
  deleteComment: vi.fn(),
  updateComment: vi.fn(),
}))

const mockAddReaction = vi.fn()
const mockRemoveReaction = vi.fn()
const mockResolvePortalAccess = vi.fn()

vi.mock('@/lib/server/domains/comments/comment.reactions', () => ({
  addReaction: (...args: unknown[]) => mockAddReaction(...args),
  removeReaction: (...args: unknown[]) => mockRemoveReaction(...args),
}))

vi.mock('@/lib/server/functions/portal-access', () => ({
  resolvePortalAccessForRequest: () => mockResolvePortalAccess(),
}))

vi.mock('@/lib/server/domains/comments/comment.permissions', () => ({
  canEditComment: (...args: unknown[]) => mockCanEditComment(...args),
  canDeleteComment: (...args: unknown[]) => mockCanDeleteComment(...args),
  softDeleteComment: vi.fn(),
  userEditComment: vi.fn(),
}))

vi.mock('@/lib/server/domains/comments/comment.pin', () => ({
  canPinComment: (...args: unknown[]) => mockCanPinComment(...args),
  pinComment: vi.fn(),
  restoreComment: vi.fn(),
  unpinComment: vi.fn(),
}))

// --- Mock: auth helpers ---

const mockGetOptionalAuth = vi.fn()
const mockHasAuthCredentials = vi.fn()
const mockRequireAuth = vi.fn()

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  getOptionalAuth: () => mockGetOptionalAuth(),
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  hasAuthCredentials: () => mockHasAuthCredentials(),
  hasSessionCookie: vi.fn(),
  policyActorFromAuth: async (auth: { principal: { id: string } }) => ({
    principalId: auth.principal.id,
    role: 'user',
  }),
}))

// --- Mock: shared roles ---

vi.mock('@/lib/shared/roles', () => ({
  isTeamMember: (role: string) => role === 'admin' || role === 'member',
}))

// --- Mock: settings service (dynamic import for createCommentFn anonymous check) ---

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPortalConfig: vi.fn().mockResolvedValue({
    features: { allowAnonymous: false },
  }),
}))

// --- Mock: activity service ---

vi.mock('@/lib/server/domains/activity/activity.service', () => ({
  createActivity: vi.fn(),
}))

// --- Handler setup ---

// Handler indices match the declaration order in comments.ts:
// 0: createCommentFn, 1: addReactionFn, 2: removeReactionFn,
// 3: getCommentPermissionsFn, 4: userEditCommentFn, 5: userDeleteCommentFn,
// 6: restoreCommentFn, 7: pinCommentFn, 8: unpinCommentFn, 9: canPinCommentFn
const HANDLER_INDEX_ADD_REACTION = 1
const HANDLER_INDEX_REMOVE_REACTION = 2
const HANDLER_INDEX_GET_COMMENT_PERMISSIONS = 3
const HANDLER_INDEX_CAN_PIN_COMMENT = 9

let getCommentPermissionsHandler: AnyHandler
let canPinCommentHandler: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()
  if (handlersByIndex.length === 0) {
    await import('../comments')
  }
  getCommentPermissionsHandler = handlersByIndex[HANDLER_INDEX_GET_COMMENT_PERMISSIONS]
  canPinCommentHandler = handlersByIndex[HANDLER_INDEX_CAN_PIN_COMMENT]
})

// --- Shared fixtures ---

const COMMENT_ID = 'comment_test123' as unknown as PostCommentId
const MOCK_AUTH_CONTEXT = {
  principal: {
    id: 'principal_test123' as PrincipalId,
    role: 'admin' as const,
  },
  user: { id: 'user_test123', email: 'test@test.com', name: 'Test', image: null },
  settings: { id: 'ws_test', slug: 'test', name: 'Test Workspace' },
  // Gate-resolved set the fns now consume (an admin holds comment.pin).
  permissions: ['comment.pin'],
}

// ============================================
// getCommentPermissionsFn
// ============================================

describe('getCommentPermissionsFn error handling', () => {
  it('should catch NotFoundError and return no-permission defaults', async () => {
    mockHasAuthCredentials.mockReturnValue(true)
    mockGetOptionalAuth.mockResolvedValue(MOCK_AUTH_CONTEXT)
    mockCanEditComment.mockRejectedValue(
      new NotFoundError('COMMENT_NOT_FOUND', 'Comment not found')
    )

    const result = await getCommentPermissionsHandler({ data: { commentId: COMMENT_ID } })

    expect(result).toEqual({ canEdit: false, canDelete: false })
  })

  it('should re-throw non-NotFoundError errors', async () => {
    mockHasAuthCredentials.mockReturnValue(true)
    mockGetOptionalAuth.mockResolvedValue(MOCK_AUTH_CONTEXT)
    mockCanEditComment.mockRejectedValue(new Error('Database connection lost'))

    await expect(getCommentPermissionsHandler({ data: { commentId: COMMENT_ID } })).rejects.toThrow(
      'Database connection lost'
    )
  })

  it('should re-throw TypeError (not a NotFoundError)', async () => {
    mockHasAuthCredentials.mockReturnValue(true)
    mockGetOptionalAuth.mockResolvedValue(MOCK_AUTH_CONTEXT)
    mockCanEditComment.mockRejectedValue(new TypeError('Cannot read properties of undefined'))

    await expect(getCommentPermissionsHandler({ data: { commentId: COMMENT_ID } })).rejects.toThrow(
      TypeError
    )
  })
})

// ============================================
// canPinCommentFn
// ============================================

describe('canPinCommentFn error handling', () => {
  it('should catch NotFoundError and return canPin=false with reason', async () => {
    mockHasAuthCredentials.mockReturnValue(true)
    mockRequireAuth.mockResolvedValue(MOCK_AUTH_CONTEXT)
    mockGetOptionalAuth.mockResolvedValue(MOCK_AUTH_CONTEXT)
    mockCanPinComment.mockRejectedValue(new NotFoundError('COMMENT_NOT_FOUND', 'Comment not found'))

    const result = await canPinCommentHandler({ data: { commentId: COMMENT_ID } })

    expect(result).toEqual({ canPin: false, reason: 'Comment not found' })
  })

  it('should re-throw non-NotFoundError errors', async () => {
    mockHasAuthCredentials.mockReturnValue(true)
    mockRequireAuth.mockResolvedValue(MOCK_AUTH_CONTEXT)
    mockGetOptionalAuth.mockResolvedValue(MOCK_AUTH_CONTEXT)
    mockCanPinComment.mockRejectedValue(new Error('Database connection lost'))

    await expect(canPinCommentHandler({ data: { commentId: COMMENT_ID } })).rejects.toThrow(
      'Database connection lost'
    )
  })

  it('should re-throw TypeError (not a NotFoundError)', async () => {
    mockHasAuthCredentials.mockReturnValue(true)
    mockRequireAuth.mockResolvedValue(MOCK_AUTH_CONTEXT)
    mockGetOptionalAuth.mockResolvedValue(MOCK_AUTH_CONTEXT)
    mockCanPinComment.mockRejectedValue(new TypeError('Cannot read properties of undefined'))

    await expect(canPinCommentHandler({ data: { commentId: COMMENT_ID } })).rejects.toThrow(
      TypeError
    )
  })
})

// ============================================
// addReactionFn / removeReactionFn on the portal site (J9, J21)
// ============================================

describe.each([
  ['addReactionFn', HANDLER_INDEX_ADD_REACTION, mockAddReaction, { added: true }],
  ['removeReactionFn', HANDLER_INDEX_REMOVE_REACTION, mockRemoveReaction, { removed: true }],
] as const)('%s on the portal site (J9, J21)', (_name, index, service, answer) => {
  const reaction = { commentId: COMMENT_ID, emoji: '👍' }

  it('refuses a caller the private portal does not admit, before reading the session (J21)', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthorized' })

    await expect(handlersByIndex[index]({ data: reaction })).rejects.toThrow(
      /Portal access required/
    )
    expect(mockRequireAuth).not.toHaveBeenCalled()
    expect(service).not.toHaveBeenCalled()
  })

  it('refuses a widget session outright (J9)', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    mockRequireAuth.mockRejectedValue(
      new Error('Access denied: Widget sessions cannot access this resource')
    )

    await expect(handlersByIndex[index]({ data: reaction })).rejects.toThrow(/Widget sessions/)
    expect(service).not.toHaveBeenCalled()
  })

  it('reacts as the signed-in caller and answers what the service answers (J21)', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    mockRequireAuth.mockResolvedValue(MOCK_AUTH_CONTEXT)
    service.mockResolvedValue(answer)

    const result = await handlersByIndex[index]({ data: reaction })

    expect(result).toEqual(answer)
    expect(service).toHaveBeenCalledWith(COMMENT_ID, '👍', 'principal_test123', {
      principalId: 'principal_test123',
      role: 'user',
    })
  })
})
