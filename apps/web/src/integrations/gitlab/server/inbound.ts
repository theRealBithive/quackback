/**
 * GitLab inbound webhook handler.
 * Receives issue state change events for two-way status sync, and issue notes
 * for comment sync.
 */

import { timingSafeEqual } from 'crypto'
import type {
  InboundCommentResult,
  InboundWebhookHandler,
  InboundWebhookResult,
} from '@/lib/server/integrations/inbound-types'

/** The project a hook body came from, as the numeric id GitLab uses everywhere
 *  else — the value `integrations.config.channelId` stores and the one that
 *  survives a project being renamed. Both hook shapes carry it, the Note Hook
 *  as a flat `project_id` and both as a nested `project.id`; a body carrying
 *  neither yields undefined rather than a guess. */
function reportedProjectId(payload: {
  project?: { id?: number | string }
  project_id?: number | string
}): string | undefined {
  const id = payload.project?.id ?? payload.project_id
  if (typeof id === 'number') return String(id)
  if (typeof id === 'string' && id !== '') return id
  return undefined
}

/** The slice of a GitLab "Note Hook" body this handler reads. */
interface GitLabNotePayload {
  object_kind?: string
  project?: { id?: number | string }
  project_id?: number | string
  user?: { name?: string }
  object_attributes?: {
    id?: number
    note?: string
    noteable_type?: string
    system?: boolean
    internal?: boolean
    action?: string
  }
  issue?: { iid?: number; confidential?: boolean }
}

export const gitlabInboundHandler: InboundWebhookHandler = {
  async verifySignature(request: Request, _body: string, secret: string): Promise<true | Response> {
    // GitLab uses a shared secret token in the X-Gitlab-Token header
    const token = request.headers.get('X-Gitlab-Token')
    if (!token) {
      return new Response('Missing token', { status: 401 })
    }

    const expected = Buffer.from(secret)
    const actual = Buffer.from(token)

    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return new Response('Invalid token', { status: 401 })
    }

    return true
  },

  async parseStatusChange(body: string): Promise<InboundWebhookResult | null> {
    const payload = JSON.parse(body) as {
      object_kind?: string
      project?: { id?: number | string }
      project_id?: number | string
      object_attributes?: {
        iid?: number
        action?: string
        state?: string
      }
    }

    if (payload.object_kind !== 'issue') return null
    if (!payload.object_attributes?.iid) return null

    const { action, state, iid } = payload.object_attributes
    if (action !== 'update' && action !== 'close' && action !== 'reopen') return null
    if (!state) return null

    // Map GitLab states: opened, closed
    const statusMap: Record<string, string> = {
      opened: 'Open',
      closed: 'Closed',
    }

    const externalStatus = statusMap[state]
    if (!externalStatus) return null

    return {
      externalId: String(iid),
      externalScope: reportedProjectId(payload),
      externalStatus,
      eventType: 'issue.state_changed',
    }
  },

  async parseComment(body: string): Promise<InboundCommentResult | null> {
    let payload: GitLabNotePayload
    try {
      payload = JSON.parse(body) as GitLabNotePayload
    } catch {
      return null
    }

    if (payload.object_kind !== 'note') return null

    const note = payload.object_attributes
    if (!note) return null

    // Only what a person typed on an issue, and only when they typed it.
    if (note.noteable_type !== 'Issue') return null
    if (note.system === true) return null
    if (note.internal === true) return null
    if (note.action !== 'create') return null

    // A confidential issue is readable by fewer people in GitLab than a team
    // member in Quackback; importing its discussion would widen the audience.
    if (payload.issue?.confidential === true) return null

    const issueIid = payload.issue?.iid
    if (typeof issueIid !== 'number') return null

    const text = typeof note.note === 'string' ? note.note.trim() : ''
    if (!text) return null

    if (typeof note.id !== 'number') return null

    // Name only. The payload also carries the author's email address, which
    // has no business crossing into Quackback.
    const authorName = payload.user?.name?.trim() || 'GitLab user'

    return {
      externalId: String(issueIid),
      externalScope: reportedProjectId(payload),
      externalCommentId: String(note.id),
      authorName,
      body: text,
    }
  },
}
