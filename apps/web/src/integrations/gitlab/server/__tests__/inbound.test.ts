/**
 * Contract — GitLab issue notes arriving as Quackback comments.
 *
 *   V1  A note a person writes on a GitLab issue that is linked to a Quackback
 *       post shows up on that post.
 *   V2  GitLab's own bookkeeping notes ("changed title", "added label",
 *       "assigned to") never become comments. Only what a human typed.
 *   V3  A note on anything that is not an issue (merge request, commit,
 *       snippet) never becomes a comment.
 *   V4  A note GitLab marks as internal never becomes visible to anyone who
 *       could not already read it in GitLab.
 *   V5  The same note delivered twice yields one comment.
 *   V6  Only the writing of a note is imported. Editing or deleting it in
 *       GitLab afterwards leaves the Quackback side as it was.
 *   V7  The comment says who wrote it in GitLab and nothing else about that
 *       person — in particular no email address, which GitLab does put in the
 *       payload.
 *   V8  The comment is attributed to the integration's own service identity,
 *       never to a Quackback user account.
 *   V9  A note for an issue that no post is linked to is ignored quietly.
 *   V10 A comment that arrived this way never causes anything to be written
 *       back to GitLab.
 *   V11 A failure while importing a note never makes GitLab see an error, and
 *       never interferes with the status sync sharing the same webhook.
 *   V12 Status sync keeps behaving exactly as it does now.
 *
 * This file covers the parsing half: V1 (which id identifies the issue), V2,
 * V3, V4, V6, V7 and the V12 regression. V5 and V8-V11 live with the ingest
 * path in lib/server/integrations/__tests__/inbound-comment.test.ts.
 *
 * The payload shape is taken from a real GitLab 19.3 "Note Hook" delivery.
 */
import { describe, it, expect } from 'vitest'
import { gitlabInboundHandler } from '../inbound'

interface NoteOverrides {
  objectKind?: string
  noteableType?: string
  system?: boolean
  internal?: boolean
  action?: string
  note?: string
  noteId?: number
  issueIid?: number | null
  authorName?: string
  authorEmail?: string
  confidential?: boolean
}

/** A GitLab "Note Hook" body, shaped like the real delivery. */
function noteWebhook(overrides: NoteOverrides = {}): string {
  const issueIid = overrides.issueIid === undefined ? 686 : overrides.issueIid
  const payload: Record<string, unknown> = {
    object_kind: overrides.objectKind ?? 'note',
    event_type: 'note',
    user: {
      id: 2,
      name: overrides.authorName ?? 'Maximilian Kindshofer',
      username: 'Maximilian',
      email: overrides.authorEmail ?? 'private@example.com',
    },
    project_id: 11,
    object_attributes: {
      id: overrides.noteId ?? 24694,
      note: overrides.note ?? 'Wont fix',
      noteable_id: 1164,
      noteable_type: overrides.noteableType ?? 'Issue',
      system: overrides.system ?? false,
      internal: overrides.internal ?? false,
      action: overrides.action ?? 'create',
      url: 'https://gitlab.example.com/g/p/-/work_items/686#note_24694',
    },
    issue:
      issueIid === null
        ? undefined
        : {
            id: 1164,
            iid: issueIid,
            title: 'Final Gitlab',
            confidential: overrides.confidential ?? false,
          },
  }
  return JSON.stringify(payload)
}

const parseComment = gitlabInboundHandler.parseComment!

describe('gitlabInboundHandler.parseComment', () => {
  it('reads a human note on a linked issue (V1)', async () => {
    const result = await parseComment(noteWebhook(), {}, {})

    expect(result).not.toBeNull()
    expect(result?.body).toBe('Wont fix')
  })

  it('identifies the issue by iid, not by the internal noteable id (V1)', async () => {
    // The hook stored String(iid) in post_external_links, so the reverse
    // lookup must use iid (686) and never noteable_id (1164).
    const result = await parseComment(noteWebhook(), {}, {})

    expect(result?.externalId).toBe('686')
  })

  it('identifies the note itself by its own id, for the duplicate check (V5)', async () => {
    const result = await parseComment(noteWebhook({ noteId: 24694 }), {}, {})

    expect(result?.externalCommentId).toBe('24694')
  })

  it('drops GitLab bookkeeping notes (V2)', async () => {
    const result = await parseComment(noteWebhook({ system: true, note: 'changed title' }), {}, {})

    expect(result).toBeNull()
  })

  it.each(['MergeRequest', 'Commit', 'Snippet'])(
    'drops a note on a %s rather than an issue (V3)',
    async (noteableType) => {
      const result = await parseComment(noteWebhook({ noteableType }), {}, {})

      expect(result).toBeNull()
    }
  )

  it('drops a note GitLab marks as internal (V4)', async () => {
    const result = await parseComment(noteWebhook({ internal: true }), {}, {})

    expect(result).toBeNull()
  })

  it.each(['update', 'destroy'])(
    'imports only the writing of a note, not %s (V6)',
    async (action) => {
      const result = await parseComment(noteWebhook({ action }), {}, {})

      expect(result).toBeNull()
    }
  )

  it('carries the author name (V7)', async () => {
    const result = await parseComment(noteWebhook({ authorName: 'Ada Lovelace' }), {}, {})

    expect(result?.authorName).toBe('Ada Lovelace')
  })

  it('carries nothing else about the author, in particular no email (V7)', async () => {
    const result = await parseComment(
      noteWebhook({ authorEmail: 'secret@internal.example' }),
      {},
      {}
    )

    expect(JSON.stringify(result)).not.toContain('secret@internal.example')
  })

  it('drops a note on a confidential issue (V4)', async () => {
    const result = await parseComment(noteWebhook({ confidential: true }), {}, {})

    expect(result).toBeNull()
  })

  it('drops a note that belongs to no issue (V3)', async () => {
    const result = await parseComment(noteWebhook({ issueIid: null }), {}, {})

    expect(result).toBeNull()
  })

  it('drops an empty note', async () => {
    const result = await parseComment(noteWebhook({ note: '   ' }), {}, {})

    expect(result).toBeNull()
  })

  it('drops a body that is not a note event', async () => {
    const result = await parseComment(noteWebhook({ objectKind: 'issue' }), {}, {})

    expect(result).toBeNull()
  })

  it('drops a body that is not JSON', async () => {
    const result = await parseComment('not json', {}, {})

    expect(result).toBeNull()
  })
})

describe('gitlabInboundHandler.parseStatusChange stays as it was (V12)', () => {
  function issueWebhook(action: string, state: string, iid = 686): string {
    return JSON.stringify({
      object_kind: 'issue',
      object_attributes: { iid, action, state },
    })
  }

  it('still maps a closed issue to Closed', async () => {
    const result = await gitlabInboundHandler.parseStatusChange(
      issueWebhook('close', 'closed'),
      {},
      {}
    )

    expect(result).toEqual({
      externalId: '686',
      externalStatus: 'Closed',
      eventType: 'issue.state_changed',
    })
  })

  it('still maps a reopened issue to Open', async () => {
    const result = await gitlabInboundHandler.parseStatusChange(
      issueWebhook('reopen', 'opened'),
      {},
      {}
    )

    expect(result?.externalStatus).toBe('Open')
  })

  it('still ignores a note event', async () => {
    expect(await gitlabInboundHandler.parseStatusChange(noteWebhook(), {}, {})).toBeNull()
  })
})
