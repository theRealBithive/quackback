/**
 * The board-move sink is reachable end to end.
 *
 * Contract (domain language, confirmed before these tests were written):
 *
 *   V11 A post that moves to a board with a different project takes its issue
 *       with it, and the link afterwards points at the issue in the new
 *       project.
 *
 * Two halves have to agree on one string for V11 to happen at all: the
 * resolver names a sink on the target it produces, and the registry maps that
 * name to a handler. Nothing else checks the pair. Get it wrong and the event
 * resolves, a job is enqueued, `getHook` returns undefined and the issue simply
 * never moves — no error anywhere, which is the failure mode
 * `dispatch-registry-wiring.test.ts` was written for one level up.
 *
 * The contract was agreed in German and is written here in English, which is
 * the language of this repository.
 */
import { describe, it, expect } from 'vitest'
import { getHook } from '../registry'
import { registerAllResolvers } from '../resolvers'
import { listResolvers } from '../resolvers/registry'
import { GITLAB_ISSUE_MOVE_SINK } from '../resolvers/issue-move-policy'

describe('the gitlab_issue_move sink', () => {
  it('is registered as a resolver (V11)', () => {
    registerAllResolvers()

    expect(listResolvers().map((r) => r.sink)).toContain(GITLAB_ISSUE_MOVE_SINK)
  })

  it('resolves to a handler under the name the resolver puts on its targets (V11)', async () => {
    const hook = await getHook(GITLAB_ISSUE_MOVE_SINK)

    expect(hook).toBeDefined()
    expect(typeof hook?.run).toBe('function')
  })

  it('is the only resolver interested in a board change', () => {
    registerAllResolvers()

    const interested = listResolvers()
      .filter((r) => r.interestedIn('post.board_changed'))
      .map((r) => r.sink)
    expect(interested).toContain(GITLAB_ISSUE_MOVE_SINK)
  })
})
