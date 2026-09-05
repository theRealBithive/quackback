// @vitest-environment happy-dom
/**
 * The timeline line a moved issue leaves behind.
 *
 * Contract (domain language, confirmed before these tests were written):
 *
 *   V11 A post that moves to a board with a different project takes its issue
 *       with it, and the link afterwards points at the issue in the new
 *       project.
 *
 * The move happens in a background job, so the post's timeline is where anyone
 * finds out that it did — and, when GitLab renumbered the issue, which number
 * to look for now. A row whose type has no entry in `ACTIVITY_CONFIG` renders
 * as nothing at all, silently, which is why this is a test and not a glance.
 *
 * The contract was agreed in German and is written here in English, which is
 * the language of this repository.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { PostId } from '@quackback/ids'

const { useQuery } = vi.hoisted(() => ({ useQuery: vi.fn() }))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery,
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock('@/lib/client/mutations/post-merge', () => ({
  useUnmergePost: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

import { PostActivityTimeline } from '../post-activity-timeline'

function showActivity(metadata: Record<string, unknown>) {
  useQuery.mockReturnValue({
    isLoading: false,
    data: [
      {
        id: 'pa_1',
        type: 'external.issue_moved',
        actorName: null,
        metadata,
        createdAt: new Date('2026-09-05T10:00:00Z').toISOString(),
      },
    ],
  })
  render(<PostActivityTimeline postId={'post_1' as PostId} />)
}

const FULL_METADATA = {
  integrationType: 'gitlab',
  fromProjectId: '101',
  toProjectId: '202',
  externalId: '7',
  externalUrl: 'https://gitlab.example.com/group/asbs/-/issues/7',
}

describe('the external.issue_moved timeline entry', () => {
  it('says which issue moved and where to (V11)', () => {
    showActivity(FULL_METADATA)

    expect(screen.getByText('Issue #7 moved to project 202')).toBeInTheDocument()
  })

  it('links to the issue in its new project (V11)', () => {
    showActivity(FULL_METADATA)

    expect(screen.getByRole('link', { name: 'View issue' })).toHaveAttribute(
      'href',
      'https://gitlab.example.com/group/asbs/-/issues/7'
    )
  })

  it('still says the issue moved when the destination is not recorded', () => {
    showActivity({ ...FULL_METADATA, toProjectId: undefined })

    expect(screen.getByText('Issue #7 moved to another project')).toBeInTheDocument()
  })

  it('still says something when the issue number is not recorded', () => {
    showActivity({ ...FULL_METADATA, externalId: undefined })

    expect(screen.getByText('The linked issue moved to project 202')).toBeInTheDocument()
  })

  it('renders the line without a link when no URL came back', () => {
    showActivity({ ...FULL_METADATA, externalUrl: undefined })

    expect(screen.getByText('Issue #7 moved to project 202')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'View issue' })).toBeNull()
  })
})
