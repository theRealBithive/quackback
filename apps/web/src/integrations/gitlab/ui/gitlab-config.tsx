import { useState, useEffect, useCallback } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useUpdateIntegration } from '@/lib/client/mutations'
import { OnDeleteConfig } from '@/components/admin/settings/integrations/on-delete-config'
import {
  StatusSyncConfig,
  type ExternalStatus,
} from '@/components/admin/settings/integrations/status-sync-config'
import { TicketStatusSyncConfig } from '@/components/admin/settings/integrations/ticket-status-sync-config'
import { fetchExternalStatusesFn } from '@/lib/server/functions/external-statuses'
import { fetchBoardsFn } from '@/lib/server/functions/boards'
import { fetchStatusesFn } from '@/lib/server/functions/statuses'
import {
  fetchBoardRoutingRulesFn,
  saveBoardRoutingRuleFn,
  removeBoardRoutingRuleFn,
} from '@/lib/server/functions/integrations'
import { fetchGitLabProjectsFn, type GitLabProject } from '@/integrations/gitlab/server/functions'

const NO_PROJECT = '__none__'

interface GitLabConfigProps {
  integrationId: string
  initialConfig: { channelId?: string }
  enabled: boolean
}

interface Board {
  id: string
  name: string
}

interface Status {
  id: string
  name: string
}

interface Rule {
  boardId: string
  projectId: string
  triggerStatusIds: string[]
}

/**
 * Board → GitLab project.
 *
 * Deliberately not the shared notification-channel router: that one is built
 * around "one channel, many boards", and this is the other way round. A board
 * points at one project, and a board with no rule creates no issue at all —
 * there is no catch-all project, so a board left unset is a decision, which is
 * why every board is listed here whether it has a rule or not.
 */
export function GitLabConfig({ integrationId, initialConfig, enabled }: GitLabConfigProps) {
  const updateMutation = useUpdateIntegration()
  const [projects, setProjects] = useState<GitLabProject[]>([])
  const [boards, setBoards] = useState<Board[]>([])
  const [statuses, setStatuses] = useState<Status[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savingBoardId, setSavingBoardId] = useState<string | null>(null)
  const [externalStatuses, setExternalStatuses] = useState<ExternalStatus[]>([])
  const [integrationEnabled, setIntegrationEnabled] = useState(enabled)

  const fetchProjects = useCallback(async () => {
    setLoadingProjects(true)
    setProjectError(null)
    try {
      setProjects(await fetchGitLabProjectsFn())
    } catch {
      setProjectError('Failed to load projects. Please try again.')
    } finally {
      setLoadingProjects(false)
    }
  }, [])

  const reloadRules = useCallback(async () => {
    setRules(await fetchBoardRoutingRulesFn({ data: { integrationId } }))
  }, [integrationId])

  useEffect(() => {
    fetchProjects()
    reloadRules()
    fetchBoardsFn().then((rows) => setBoards(rows.map((b) => ({ id: b.id, name: b.name }))))
    fetchStatusesFn().then((rows) => setStatuses(rows.map((s) => ({ id: s.id, name: s.name }))))
    fetchExternalStatusesFn({ data: { integrationType: 'gitlab' } })
      .then(setExternalStatuses)
      .catch(() => {
        // Non-critical — status mapping just won't show options.
      })
  }, [fetchProjects, reloadRules])

  const handleEnabledChange = (checked: boolean) => {
    setIntegrationEnabled(checked)
    updateMutation.mutate({ id: integrationId, enabled: checked })
  }

  const ruleFor = (boardId: string) => rules.find((r) => r.boardId === boardId)

  const defaultTriggerStatusIds = () => {
    const first = statuses[0]
    return first ? [first.id] : []
  }

  async function writeRule(boardId: string, projectId: string, triggerStatusIds: string[]) {
    setSavingBoardId(boardId)
    setSaveError(null)
    try {
      if (projectId === NO_PROJECT) {
        await removeBoardRoutingRuleFn({ data: { integrationId, boardId } })
      } else if (triggerStatusIds.length === 0) {
        setSaveError('Pick at least one status that should create the issue.')
        return
      } else {
        await saveBoardRoutingRuleFn({
          data: { integrationId, boardId, projectId, triggerStatusIds },
        })
      }
      await reloadRules()
    } catch {
      setSaveError('Failed to save the routing rule. Please try again.')
    } finally {
      setSavingBoardId(null)
    }
  }

  const handleProjectChange = (boardId: string, projectId: string) => {
    const existing = ruleFor(boardId)
    const triggerStatusIds = existing?.triggerStatusIds ?? defaultTriggerStatusIds()
    writeRule(boardId, projectId, triggerStatusIds)
  }

  const handleStatusToggle = (boardId: string, statusId: string, checked: boolean) => {
    const existing = ruleFor(boardId)
    if (!existing) return
    const next = checked
      ? [...existing.triggerStatusIds, statusId]
      : existing.triggerStatusIds.filter((id) => id !== statusId)
    writeRule(boardId, existing.projectId, next)
  }

  const legacyProjectStillSet = Boolean(initialConfig.channelId) && rules.length === 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="enabled-toggle" className="text-base font-medium">
            Integration enabled
          </Label>
          <p className="text-xs text-muted-foreground">
            Turn off to pause all GitLab synchronization
          </p>
        </div>
        <Switch
          id="enabled-toggle"
          checked={integrationEnabled}
          onCheckedChange={handleEnabledChange}
          disabled={updateMutation.isPending}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base font-medium">Board → GitLab project</Label>
            <p className="text-xs text-muted-foreground">
              An issue is created when a post on this board reaches one of the statuses below. A
              board with no project creates no issues.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchProjects}
            disabled={loadingProjects}
            className="h-8 gap-1.5 text-xs"
          >
            <ArrowPathIcon className={`h-3.5 w-3.5 ${loadingProjects ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {projectError && <p className="text-sm text-destructive">{projectError}</p>}
        {saveError && <p className="text-sm text-destructive">{saveError}</p>}

        {legacyProjectStillSet && (
          <p className="rounded-md border border-border/50 bg-muted/40 p-3 text-xs text-muted-foreground">
            This integration still has a single project set from before per-board routing. It is no
            longer used for new issues, and it is removed the first time you save a rule here.
          </p>
        )}

        <div className="space-y-3">
          {boards.map((board) => {
            const rule = ruleFor(board.id)
            return (
              <div key={board.id} className="rounded-lg border border-border/50 p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-sm">{board.name}</div>
                  <Select
                    value={rule?.projectId ?? NO_PROJECT}
                    onValueChange={(projectId) => handleProjectChange(board.id, projectId)}
                    disabled={loadingProjects || !integrationEnabled || savingBoardId === board.id}
                  >
                    <SelectTrigger className="w-64" aria-label={`GitLab project for ${board.name}`}>
                      <SelectValue placeholder="Not connected" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PROJECT}>Not connected</SelectItem>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={String(project.id)}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {rule && (
                  <div className="flex flex-wrap gap-3 pt-1">
                    {statuses.map((status) => (
                      <label
                        key={status.id}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground"
                      >
                        <input
                          type="checkbox"
                          checked={rule.triggerStatusIds.includes(status.id)}
                          onChange={(e) =>
                            handleStatusToggle(board.id, status.id, e.target.checked)
                          }
                          disabled={!integrationEnabled || savingBoardId === board.id}
                        />
                        {status.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <StatusSyncConfig
        integrationId={integrationId}
        integrationType="gitlab"
        config={initialConfig}
        enabled={integrationEnabled}
        externalStatuses={externalStatuses}
        isManual
      />

      <TicketStatusSyncConfig
        integrationId={integrationId}
        config={initialConfig}
        enabled={integrationEnabled}
        externalStatuses={externalStatuses}
      />

      <OnDeleteConfig
        integrationId={integrationId}
        integrationType="gitlab"
        config={initialConfig}
        enabled={integrationEnabled}
      />
    </div>
  )
}
