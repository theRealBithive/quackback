// @vitest-environment happy-dom
/**
 * The GitLab settings page, which is where board→project routing is set.
 *
 * Contract (the plan's numbering):
 *
 *   V2  A board with no project recorded creates no issue. There is no
 *       catch-all project.
 *   V5  When a board's mapping is changed, the new mapping applies to the next
 *       post, without a restart and without a wait.
 *   V6  Several boards may point at the same project; a board points at at
 *       most one project. Changing one board's rule never changes another's.
 *
 * The page deliberately does not reuse the shared notification-channel router:
 * that is built around "one channel, many boards", and this is the other way
 * round.
 *
 * One test here looks like it is about nothing. It is the load-bearing one:
 * the page must not offer a plain event switch. The generic integration update
 * writes event mappings with `targetKey` at its `'default'` default, which
 * re-creates the filterless row that matches every board — so a switch put
 * back here would quietly restore the catch-all V2 forbids, and the settings
 * page would go on looking correct.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const hoisted = vi.hoisted(() => ({
  save: vi.fn(),
  remove: vi.fn(),
  rules: vi.fn(),
}))

vi.mock('@/lib/client/mutations', () => ({
  useUpdateIntegration: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}))

vi.mock('@/lib/server/functions/integrations', () => ({
  fetchBoardRoutingRulesFn: hoisted.rules,
  saveBoardRoutingRuleFn: hoisted.save,
  removeBoardRoutingRuleFn: hoisted.remove,
}))

vi.mock('@/lib/server/functions/boards', () => ({
  fetchBoardsFn: vi.fn().mockResolvedValue([
    { id: 'board_ds', name: 'Datenschutzkulpix' },
    { id: 'board_asbs', name: 'ASBS-Kulpix' },
    { id: 'board_gwg', name: 'GWG-Kulpix' },
  ]),
}))

vi.mock('@/lib/server/functions/statuses', () => ({
  fetchStatusesFn: vi.fn().mockResolvedValue([
    { id: 'status_new', name: 'New' },
    { id: 'status_planned', name: 'Planned' },
  ]),
}))

vi.mock('@/integrations/gitlab/server/functions', () => ({
  fetchGitLabProjectsFn: vi.fn().mockResolvedValue([
    { id: 111, name: 'datenschutz' },
    { id: 222, name: 'asbs' },
  ]),
}))

vi.mock('@/lib/server/functions/external-statuses', () => ({
  fetchExternalStatusesFn: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/components/admin/settings/integrations/on-delete-config', () => ({
  OnDeleteConfig: () => null,
}))
vi.mock('@/components/admin/settings/integrations/status-sync-config', () => ({
  StatusSyncConfig: () => null,
}))
vi.mock('@/components/admin/settings/integrations/ticket-status-sync-config', () => ({
  TicketStatusSyncConfig: () => null,
}))

// A native <select> so a change event can be fired at it.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string
    onValueChange: (v: string) => void
    disabled?: boolean
    children: React.ReactNode
  }) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.value)}
      data-testid="project-select"
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
}))

import { GitLabConfig } from '../gitlab-config'

const props = { integrationId: 'int_1', initialConfig: {}, enabled: true }

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.save.mockResolvedValue({ success: true })
  hoisted.remove.mockResolvedValue({ success: true })
  hoisted.rules.mockResolvedValue([
    { boardId: 'board_asbs', projectId: '222', triggerStatusIds: ['status_planned'] },
  ])
})

describe('every board is listed, connected or not (V2)', () => {
  it('lists a board that has no project too, rather than hiding it', async () => {
    render(<GitLabConfig {...props} />)

    expect(await screen.findByText('GWG-Kulpix')).toBeTruthy()
    expect(screen.getByText('Datenschutzkulpix')).toBeTruthy()
    expect(screen.getByText('ASBS-Kulpix')).toBeTruthy()
  })

  it('shows an unconnected board as connected to nothing', async () => {
    render(<GitLabConfig {...props} />)

    const selects = (await screen.findAllByTestId('project-select')) as HTMLSelectElement[]
    // Boards come back in order: datenschutz (no rule), asbs (rule), gwg (no rule).
    expect(selects[0].value).toBe('__none__')
    expect(selects[1].value).toBe('222')
    expect(selects[2].value).toBe('__none__')
  })
})

describe('connecting a board (V6)', () => {
  it('saves a rule for that board and no other', async () => {
    render(<GitLabConfig {...props} />)
    const selects = (await screen.findAllByTestId('project-select')) as HTMLSelectElement[]

    fireEvent.change(selects[0], { target: { value: '111' } })

    await waitFor(() => expect(hoisted.save).toHaveBeenCalledTimes(1))
    expect(hoisted.save).toHaveBeenCalledWith({
      data: {
        integrationId: 'int_1',
        boardId: 'board_ds',
        projectId: '111',
        triggerStatusIds: ['status_new'],
      },
    })
  })

  it('keeps the triggering statuses a board already had when its project changes', async () => {
    render(<GitLabConfig {...props} />)
    const selects = (await screen.findAllByTestId('project-select')) as HTMLSelectElement[]

    fireEvent.change(selects[1], { target: { value: '111' } })

    await waitFor(() => expect(hoisted.save).toHaveBeenCalledTimes(1))
    expect(hoisted.save.mock.calls[0][0].data.triggerStatusIds).toEqual(['status_planned'])
  })
})

describe('disconnecting a board (V2)', () => {
  it('removes the rule rather than saving an empty one', async () => {
    render(<GitLabConfig {...props} />)
    const selects = (await screen.findAllByTestId('project-select')) as HTMLSelectElement[]

    fireEvent.change(selects[1], { target: { value: '__none__' } })

    await waitFor(() => expect(hoisted.remove).toHaveBeenCalledTimes(1))
    expect(hoisted.remove).toHaveBeenCalledWith({
      data: { integrationId: 'int_1', boardId: 'board_asbs' },
    })
    expect(hoisted.save).not.toHaveBeenCalled()
  })
})

describe('the page offers no way to re-create the catch-all (V2)', () => {
  it('has no event switch, whose upsert would write the filterless row back', async () => {
    render(<GitLabConfig {...props} />)
    await screen.findByText('GWG-Kulpix')

    expect(screen.queryByText('New feedback submitted')).toBeNull()
    expect(screen.queryByText(/Choose which events trigger/i)).toBeNull()
  })

  it('has no instance-wide project picker beside the per-board ones', async () => {
    render(<GitLabConfig {...props} />)
    await screen.findByText('GWG-Kulpix')

    const selects = screen.getAllByTestId('project-select')
    expect(selects).toHaveLength(3)
  })
})

describe('an instance that still carries the old single project', () => {
  it('says the setting is no longer used, rather than leaving it to be guessed at', async () => {
    hoisted.rules.mockResolvedValue([])

    render(<GitLabConfig {...props} initialConfig={{ channelId: '999' }} />)

    expect(await screen.findByText(/no longer used for new issues/i)).toBeTruthy()
  })

  it('says nothing once per-board rules exist', async () => {
    render(<GitLabConfig {...props} initialConfig={{ channelId: '999' }} />)
    await screen.findByText('GWG-Kulpix')

    expect(screen.queryByText(/no longer used for new issues/i)).toBeNull()
  })
})
