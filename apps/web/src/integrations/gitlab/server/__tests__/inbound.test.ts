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
 *   V13 A note reaches only the post whose issue lives in the project the note
 *       came from — never a post of another product, even when the two issue
 *       numbers are identical.
 *   V14 A note that cannot be attributed to exactly one post is ignored
 *       quietly. Nothing is guessed.
 *   V15 Links made before projects were recorded keep working unchanged, as
 *       long as no link that does record one carries the same issue number;
 *       where one does, V14 decides.
 *
 * V13-V15 are the plan's V8-V10; they arrived with per-board project routing,
 * which is what made two projects — and therefore colliding issue numbers —
 * reachable at all.
 *
 * This file covers the parsing half: V1 (which id identifies the issue), V2,
 * V3, V4, V6, V7, the V12 regression, and the reporting project V13 rests on.
 * V5 and V8-V11 live with the ingest path in
 * lib/server/integrations/__tests__/inbound-comment.test.ts, as do V13-V15.
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
  projectId?: number | null
  projectObject?: boolean
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
    ...(overrides.projectId === null
      ? {}
      : overrides.projectObject === false
        ? { project_id: overrides.projectId ?? 11 }
        : {
            project_id: overrides.projectId ?? 11,
            project: { id: overrides.projectId ?? 11, path_with_namespace: 'g/p' },
          }),
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

  it('names the project the note came from, so the lookup can tell products apart (V13)', async () => {
    const result = await parseComment(noteWebhook({ projectId: 202 }), {}, {})

    expect(result?.externalScope).toBe('202')
  })

  it('reads the project id from the flat field when GitLab sends no project object (V13)', async () => {
    const result = await parseComment(noteWebhook({ projectId: 202, projectObject: false }), {}, {})

    expect(result?.externalScope).toBe('202')
  })

  it('names no project when the payload carries none, rather than inventing one (V15)', async () => {
    const result = await parseComment(noteWebhook({ projectId: null }), {}, {})

    expect(result).not.toBeNull()
    expect(result?.externalScope).toBeUndefined()
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

describe('gitlabInboundHandler.verifySignature says which way it failed', () => {
  // Both answers are 401, and the difference between them is the whole
  // diagnosis an operator gets: a missing header means GitLab was never told
  // the secret, a mismatched one means it was told the wrong secret.
  function request(headers: Record<string, string>): Request {
    return new Request('http://localhost/api/integrations/gitlab/webhook', {
      method: 'POST',
      headers,
      body: '{}',
    })
  }

  it('names an absent token', async () => {
    const result = await gitlabInboundHandler.verifySignature(request({}), '{}', 'secret')

    expect(result).toBeInstanceOf(Response)
    expect(await (result as Response).text()).toBe('Missing token')
  })

  it('names a wrong token', async () => {
    const result = await gitlabInboundHandler.verifySignature(
      request({ 'X-Gitlab-Token': 'wrong!' }),
      '{}',
      'secret'
    )

    expect(result).toBeInstanceOf(Response)
    expect(await (result as Response).text()).toBe('Invalid token')
  })

  it('accepts the right token', async () => {
    expect(
      await gitlabInboundHandler.verifySignature(
        request({ 'X-Gitlab-Token': 'secret' }),
        '{}',
        'secret'
      )
    ).toBe(true)
  })
})

describe('gitlabInboundHandler reads the reporting project defensively (V13/V15)', () => {
  // The project id decides which product a hook belongs to, and it arrives as
  // untrusted JSON. These pin what happens for every shape that is not the
  // plain number GitLab documents.
  const parse = gitlabInboundHandler.parseStatusChange

  function issueWith(project: unknown): string {
    return JSON.stringify({
      object_kind: 'issue',
      project,
      object_attributes: { iid: 686, action: 'close', state: 'closed' },
    })
  }

  it('accepts a project id sent as a string', async () => {
    expect((await parse(issueWith({ id: '202' }), {}, {}))?.externalScope).toBe('202')
  })

  it('treats an empty project id as no project rather than as a container named ""', async () => {
    expect((await parse(issueWith({ id: '' }), {}, {}))?.externalScope).toBeUndefined()
  })

  it('treats a null project id as no project', async () => {
    expect((await parse(issueWith({ id: null }), {}, {}))?.externalScope).toBeUndefined()
  })

  it('treats a structured project id as no project', async () => {
    expect((await parse(issueWith({ id: { nested: 1 } }), {}, {}))?.externalScope).toBeUndefined()
  })

  it('prefers the nested project object over the flat field', async () => {
    const body = JSON.stringify({
      object_kind: 'issue',
      project_id: 11,
      project: { id: 202 },
      object_attributes: { iid: 686, action: 'close', state: 'closed' },
    })

    expect((await parse(body, {}, {}))?.externalScope).toBe('202')
  })
})

describe('gitlabInboundHandler.parseStatusChange rejects what it cannot trust', () => {
  const parse = gitlabInboundHandler.parseStatusChange

  it('ignores a hook that is not about an issue, even when it looks like one', async () => {
    // A merge request carries the same iid/action/state shape, so only the
    // object_kind check keeps it out.
    const body = JSON.stringify({
      object_kind: 'merge_request',
      object_attributes: { iid: 686, action: 'close', state: 'closed' },
    })

    expect(await parse(body, {}, {})).toBeNull()
  })

  it('ignores an issue hook with no attributes at all', async () => {
    expect(await parse(JSON.stringify({ object_kind: 'issue' }), {}, {})).toBeNull()
  })

  it('ignores an issue hook that names no issue', async () => {
    const body = JSON.stringify({
      object_kind: 'issue',
      object_attributes: { action: 'close', state: 'closed' },
    })

    expect(await parse(body, {}, {})).toBeNull()
  })

  it('reads a plain update, not only close and reopen', async () => {
    const body = JSON.stringify({
      object_kind: 'issue',
      object_attributes: { iid: 686, action: 'update', state: 'closed' },
    })

    expect((await parse(body, {}, {}))?.externalStatus).toBe('Closed')
  })

  it('ignores an action that is not a state change', async () => {
    const body = JSON.stringify({
      object_kind: 'issue',
      object_attributes: { iid: 686, action: 'open', state: 'opened' },
    })

    expect(await parse(body, {}, {})).toBeNull()
  })

  it('ignores a state GitLab has no mapping for', async () => {
    const body = JSON.stringify({
      object_kind: 'issue',
      object_attributes: { iid: 686, action: 'update', state: 'locked' },
    })

    expect(await parse(body, {}, {})).toBeNull()
  })
})

describe('gitlabInboundHandler.parseComment rejects what it cannot trust', () => {
  it('ignores a note hook with no attributes at all', async () => {
    expect(await parseComment(JSON.stringify({ object_kind: 'note' }), {}, {})).toBeNull()
  })

  it('ignores a note whose text is not text', async () => {
    const body = JSON.stringify({
      object_kind: 'note',
      object_attributes: {
        id: 24694,
        note: 42,
        noteable_type: 'Issue',
        system: false,
        internal: false,
        action: 'create',
      },
      issue: { iid: 686, confidential: false },
    })

    expect(await parseComment(body, {}, {})).toBeNull()
  })

  it('ignores a note with no id of its own, since the duplicate check needs one', async () => {
    const body = JSON.stringify({
      object_kind: 'note',
      object_attributes: {
        note: 'Wont fix',
        noteable_type: 'Issue',
        system: false,
        internal: false,
        action: 'create',
      },
      issue: { iid: 686, confidential: false },
    })

    expect(await parseComment(body, {}, {})).toBeNull()
  })

  it('trims the author name (V7)', async () => {
    const result = await parseComment(noteWebhook({ authorName: '  Maximilian  ' }), {}, {})

    expect(result?.authorName).toBe('Maximilian')
  })

  it('falls back to a generic author when the payload names none (V7)', async () => {
    const withoutName = JSON.stringify({
      object_kind: 'note',
      user: { id: 2 },
      object_attributes: {
        id: 24694,
        note: 'Wont fix',
        noteable_type: 'Issue',
        system: false,
        internal: false,
        action: 'create',
      },
      issue: { iid: 686, confidential: false },
    })

    expect((await parseComment(withoutName, {}, {}))?.authorName).toBe('GitLab user')
  })

  it('falls back to a generic author when the payload names no user at all (V7)', async () => {
    const withoutUser = JSON.stringify({
      object_kind: 'note',
      object_attributes: {
        id: 24694,
        note: 'Wont fix',
        noteable_type: 'Issue',
        system: false,
        internal: false,
        action: 'create',
      },
      issue: { iid: 686, confidential: false },
    })

    expect((await parseComment(withoutUser, {}, {}))?.authorName).toBe('GitLab user')
  })
})

describe('gitlabInboundHandler.parseStatusChange stays as it was (V12)', () => {
  function issueWebhook(action: string, state: string, iid = 686, projectId = 11): string {
    return JSON.stringify({
      object_kind: 'issue',
      project: { id: projectId, path_with_namespace: 'g/p' },
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
      externalScope: '11',
      externalStatus: 'Closed',
      eventType: 'issue.state_changed',
    })
  })

  it('names the project the state change came from (V13)', async () => {
    const result = await gitlabInboundHandler.parseStatusChange(
      issueWebhook('close', 'closed', 686, 202),
      {},
      {}
    )

    expect(result?.externalScope).toBe('202')
  })

  it('names no project when the payload carries none (V15)', async () => {
    const bare = JSON.stringify({
      object_kind: 'issue',
      object_attributes: { iid: 686, action: 'close', state: 'closed' },
    })

    const result = await gitlabInboundHandler.parseStatusChange(bare, {}, {})

    expect(result?.externalId).toBe('686')
    expect(result?.externalScope).toBeUndefined()
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
