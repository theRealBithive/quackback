/**
 * Property coverage for the GitLab note parser. The numbered contract lives in
 * inbound.test.ts; these state the same guarantees as universals rather than
 * as examples.
 *
 *   V1  A note a person writes on a GitLab issue that is linked to a Quackback
 *       post shows up on that post — identified by the issue's iid.
 *   V2  GitLab's own bookkeeping notes never become comments.
 *   V3  A note on anything that is not an issue never becomes a comment.
 *   V4  A note GitLab marks as internal never becomes visible in Quackback.
 *   V5  The same note delivered twice yields one comment (so the note's own id
 *       has to identify it).
 *   V6  Only the writing of a note is imported.
 *   V7  The comment says who wrote it and nothing else about that person.
 *
 * Two of these are stated as non-interference: changing a field the parser
 * must not read never changes what comes out. That is stronger than checking
 * an example output for an absent substring, and it cannot produce a spurious
 * counterexample when a generated name happens to look like an email.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { gitlabInboundHandler } from '../inbound'

const parseComment = gitlabInboundHandler.parseComment!

interface NoteFields {
  authorName: string
  email: string
  note: string
  noteId: number
  noteableId: number
  issueIid: number
  system: boolean
  internal: boolean
  confidential: boolean
  action: string
  noteableType: string
}

const noteFields = fc.record<NoteFields>({
  authorName: fc.string(),
  email: fc.string(),
  note: fc.string(),
  noteId: fc.integer(),
  noteableId: fc.integer(),
  issueIid: fc.integer(),
  system: fc.boolean(),
  internal: fc.boolean(),
  confidential: fc.boolean(),
  action: fc.constantFrom('create', 'update', 'destroy'),
  noteableType: fc.constantFrom('Issue', 'MergeRequest', 'Commit', 'Snippet'),
})

function build(fields: NoteFields): string {
  return JSON.stringify({
    object_kind: 'note',
    event_type: 'note',
    user: { id: 2, name: fields.authorName, username: 'u', email: fields.email },
    project_id: 11,
    object_attributes: {
      id: fields.noteId,
      note: fields.note,
      noteable_id: fields.noteableId,
      noteable_type: fields.noteableType,
      system: fields.system,
      internal: fields.internal,
      action: fields.action,
    },
    issue: { id: fields.noteableId, iid: fields.issueIid, confidential: fields.confidential },
  })
}

describe('gitlab note parser properties', () => {
  it('never invents a value: whatever comes out mirrors the payload (V1, V5)', async () => {
    // Unguarded — asserted on every generated payload, admissible or not, so
    // no branch of the parser escapes it.
    await fc.assert(
      fc.asyncProperty(noteFields, async (fields) => {
        const result = await parseComment(build(fields), {}, {})

        const mirrorsPayload =
          result === null ||
          (result.externalId === String(fields.issueIid) &&
            result.externalCommentId === String(fields.noteId) &&
            result.body === fields.note.trim() &&
            result.authorName === (fields.authorName.trim() || 'GitLab user'))

        expect(mirrorsPayload).toBe(true)
      })
    )
  })

  it('never returns an empty comment', async () => {
    await fc.assert(
      fc.asyncProperty(noteFields, async (fields) => {
        const result = await parseComment(build(fields), {}, {})

        expect(result === null || result.body.length > 0).toBe(true)
      })
    )
  })

  it('never reads the author email (V7)', async () => {
    await fc.assert(
      fc.asyncProperty(noteFields, fc.string(), fc.string(), async (fields, one, other) => {
        const withOne = await parseComment(build({ ...fields, email: one }), {}, {})
        const withOther = await parseComment(build({ ...fields, email: other }), {}, {})

        expect(withOne).toEqual(withOther)
      })
    )
  })

  it('identifies the issue by iid, never by the internal noteable id (V1)', async () => {
    await fc.assert(
      fc.asyncProperty(noteFields, fc.integer(), fc.integer(), async (fields, one, other) => {
        const withOne = await parseComment(build({ ...fields, noteableId: one }), {}, {})
        const withOther = await parseComment(build({ ...fields, noteableId: other }), {}, {})

        expect(withOne).toEqual(withOther)
      })
    )
  })

  it('drops every bookkeeping note, whatever else the payload says (V2)', async () => {
    await fc.assert(
      fc.asyncProperty(noteFields, async (fields) => {
        expect(await parseComment(build({ ...fields, system: true }), {}, {})).toBeNull()
      })
    )
  })

  it('drops every internal note, whatever else the payload says (V4)', async () => {
    await fc.assert(
      fc.asyncProperty(noteFields, async (fields) => {
        expect(await parseComment(build({ ...fields, internal: true }), {}, {})).toBeNull()
      })
    )
  })

  it('drops every note on a confidential issue (V4)', async () => {
    await fc.assert(
      fc.asyncProperty(noteFields, async (fields) => {
        expect(await parseComment(build({ ...fields, confidential: true }), {}, {})).toBeNull()
      })
    )
  })

  it.each(['MergeRequest', 'Commit', 'Snippet'])(
    'drops every note on a %s, whatever else the payload says (V3)',
    async (noteableType) => {
      await fc.assert(
        fc.asyncProperty(noteFields, async (fields) => {
          expect(await parseComment(build({ ...fields, noteableType }), {}, {})).toBeNull()
        })
      )
    }
  )

  it.each(['update', 'destroy'])(
    'drops every %s of a note, whatever else the payload says (V6)',
    async (action) => {
      await fc.assert(
        fc.asyncProperty(noteFields, async (fields) => {
          expect(await parseComment(build({ ...fields, action }), {}, {})).toBeNull()
        })
      )
    }
  )

  it('accepts an admissible note regardless of who wrote it or what it says (V1)', async () => {
    await fc.assert(
      fc.asyncProperty(noteFields, async (fields) => {
        const admissible = {
          ...fields,
          system: false,
          internal: false,
          confidential: false,
          action: 'create',
          noteableType: 'Issue',
          note: `${fields.note}x`, // non-empty by construction, not by filtering
        }

        expect(await parseComment(build(admissible), {}, {})).not.toBeNull()
      })
    )
  })
})
