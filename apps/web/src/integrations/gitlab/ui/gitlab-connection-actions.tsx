import { OAuthConnectionActions } from '@/components/admin/settings/integrations/oauth-connection-actions'
import { getGitLabConnectUrl } from '@/integrations/gitlab/server/functions'

interface GitLabConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function GitLabConnectionActions({
  integrationId,
  isConnected,
}: GitLabConnectionActionsProps) {
  return (
    <OAuthConnectionActions
      integrationId={integrationId}
      isConnected={isConnected}
      searchParamKey="gitlab"
      getConnectUrl={getGitLabConnectUrl}
      displayName="GitLab"
      disconnectDescription="This removes the GitLab connection together with its board rules and its webhook secret, and stops all synchronization. To renew the authorization and keep both, use Reconnect instead."
    />
  )
}
