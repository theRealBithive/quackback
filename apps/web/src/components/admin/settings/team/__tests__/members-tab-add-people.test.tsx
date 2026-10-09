// @vitest-environment happy-dom
/**
 * The Members tab opens the Add people dialog from its "Add people" button,
 * letting only an admin grant Admin.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const teamData = {
  members: [
    {
      id: 'principal_admin',
      userId: 'user_admin',
      userName: 'Ada Admin',
      userEmail: 'ada@example.com',
      role: 'admin',
      assignedRole: null,
      lastSignInAt: null,
    },
  ],
  avatarMap: {},
  formattedInvitations: [],
  seatUsage: { used: 1, limit: 5 },
}

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: () => ({ data: teamData }),
  useQueryClient: () => ({}),
}))
vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: { teamMembersAndInvitations: () => ({}) },
}))
// The fork's members tab reads the session from the root route context and
// takes the workspace name as a prop.
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({ session: { user: { email: 'ada@example.com' } } }),
}))
vi.mock('@/components/admin/settings/team/add-people-dialog', () => ({
  AddPeopleDialog: (props: { open: boolean; canGrantAdmin: boolean; workspaceName?: string }) =>
    props.open ? (
      <div role="dialog" data-can-grant-admin={String(props.canGrantAdmin)}>
        Add people to {props.workspaceName}
      </div>
    ) : null,
}))
vi.mock('@/components/admin/settings/team/cloud-ownership-actions', () => ({
  CloudOwnershipActions: () => null,
}))
vi.mock('@/components/admin/settings/team/member-actions', () => ({ MemberActions: () => null }))
// The fork keeps its Add seat dialog beside Add people; it is not under test here.
vi.mock('@/components/admin/settings/billing/add-seats-dialog', () => ({
  AddSeatsDialog: () => null,
}))

import { MembersTab } from '../members-tab'

afterEach(cleanup)

describe('MembersTab add people', () => {
  it.each([
    ['admin', 'true'],
    ['member', 'false'],
  ] as const)('opens the dialog for a %s, who may grant Admin: %s', async (role, canGrant) => {
    render(
      <MembersTab
        workspaceName="Acme"
        currentMember={{ id: 'principal_admin' as never, role, userId: 'user_admin' as never }}
        canManageMembers
      />
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: /invite member/i })).toBeNull()
    // The seat count sits next to the button.
    expect(screen.getByText('1 of 5 seats')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add people' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('data-can-grant-admin', canGrant)
    expect(dialog).toHaveTextContent('Add people to Acme')
  })

  it('offers no Add people to someone who cannot manage members', () => {
    render(
      <MembersTab
        workspaceName="Acme"
        currentMember={{
          id: 'principal_admin' as never,
          role: 'member',
          userId: 'user_admin' as never,
        }}
        canManageMembers={false}
      />
    )
    expect(screen.queryByRole('button', { name: 'Add people' })).toBeNull()
  })
})
