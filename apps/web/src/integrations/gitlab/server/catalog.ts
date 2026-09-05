import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const gitlabCatalog: IntegrationCatalogEntry = {
  id: 'gitlab',
  name: 'GitLab',
  description:
    'Create issues in GitLab (GitLab.com or self-hosted, 18.10 or newer) from feedback and sync statuses.',
  category: 'issue_tracking',
  iconBg: 'bg-[#FC6D26]',
  settingsPath: '/admin/settings/integrations/gitlab',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/gitlab',
}
