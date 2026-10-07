/**
 * Connecting an integration before its platform credentials exist is a setup
 * step the admin has not done yet, not a server fault. Every integration that
 * connects through OAuth refuses it the same way: a typed 400 the
 * server-function log records at warn.
 *
 * Contract (confirmed list for batch K, upstream #688; the full list is in
 * lib/server/__tests__/runtime-error-log.test.ts):
 *
 *   L5 Connecting an integration whose platform credentials are missing is
 *      refused with a clear 400 and logged as a warning.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ValidationError } from '@/lib/shared/errors'
import { runWithServerFnLogging } from '@/lib/server/middleware/server-fn-log'

const hoisted = vi.hoisted(() => ({
  hasPlatformCredentials: vi.fn(async (_type: string) => false),
  requireAuth: vi.fn(async () => ({
    settings: { id: 'workspace_1' },
    principal: { id: 'principal_1' },
  })),
}))

// The exported consts stay callable, so each connect function is reached by name.
vi.mock('@tanstack/react-start', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start')>()),
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      middleware: () => chain,
      handler: (fn: (args: unknown) => unknown) =>
        Object.assign((args: unknown) => fn(args ?? {}), chain),
    }
    return chain
  },
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  hasPlatformCredentials: hoisted.hasPlatformCredentials,
}))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://feedback.example.com' } }))
vi.mock('@/lib/server/auth/oauth-state', () => ({ signOAuthState: () => 'signed-state' }))

type ConnectFn = (args?: unknown) => Promise<unknown>

/** Every connect function that checks platform credentials, with the type it checks. */
const CONNECTS: Array<{
  type: string
  name: string
  load: () => Promise<Record<string, unknown>>
  args?: unknown
}> = [
  { type: 'asana', name: 'getAsanaConnectUrl', load: () => import('../asana/server/functions') },
  {
    type: 'clickup',
    name: 'getClickUpConnectUrl',
    load: () => import('../clickup/server/functions'),
  },
  {
    type: 'discord',
    name: 'getDiscordConnectUrl',
    load: () => import('../discord/server/functions'),
  },
  { type: 'github', name: 'getGitHubConnectUrl', load: () => import('../github/server/functions') },
  { type: 'gitlab', name: 'getGitLabConnectUrl', load: () => import('../gitlab/server/functions') },
  {
    type: 'hubspot',
    name: 'getHubSpotConnectUrl',
    load: () => import('../hubspot/server/functions'),
  },
  {
    type: 'intercom',
    name: 'getIntercomConnectUrl',
    load: () => import('../intercom/server/functions'),
  },
  { type: 'jira', name: 'getJiraConnectUrl', load: () => import('../jira/server/functions') },
  { type: 'linear', name: 'getLinearConnectUrl', load: () => import('../linear/server/functions') },
  { type: 'monday', name: 'getMondayConnectUrl', load: () => import('../monday/server/functions') },
  { type: 'notion', name: 'getNotionConnectUrl', load: () => import('../notion/server/functions') },
  {
    type: 'salesforce',
    name: 'getSalesforceConnectUrl',
    load: () => import('../salesforce/server/functions'),
  },
  { type: 'slack', name: 'getSlackConnectUrl', load: () => import('../slack/server/functions') },
  { type: 'teams', name: 'getTeamsConnectUrl', load: () => import('../teams/server/functions') },
  { type: 'trello', name: 'getTrelloConnectUrl', load: () => import('../trello/server/functions') },
  {
    type: 'zendesk',
    name: 'getZendeskConnectUrl',
    load: () => import('../zendesk/server/functions'),
    args: { data: { subdomain: 'acme' } },
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.hasPlatformCredentials.mockResolvedValue(false)
})

describe.each(CONNECTS)('connecting $type without platform credentials (L5)', (entry) => {
  async function connectFn(): Promise<ConnectFn> {
    const module = await entry.load()
    return module[entry.name] as ConnectFn
  }

  it('is refused with a typed 400 that says what is missing (L5)', async () => {
    const connect = await connectFn()

    const error = await connect(entry.args).then(
      () => undefined,
      (thrown: unknown) => thrown
    )

    expect(hoisted.hasPlatformCredentials).toHaveBeenCalledWith(entry.type)
    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).statusCode).toBe(400)
    expect((error as ValidationError).code).toBe('PLATFORM_CREDENTIALS_NOT_CONFIGURED')
    expect((error as ValidationError).message).toMatch(/platform credentials not configured/)
  })

  it('is logged as a warning, not an error (L5)', async () => {
    const connect = await connectFn()
    const log = { warn: vi.fn(), error: vi.fn() }

    await expect(
      runWithServerFnLogging({
        next: () => connect(entry.args),
        name: entry.name,
        log: log as never,
      })
    ).rejects.toBeInstanceOf(ValidationError)

    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.error).not.toHaveBeenCalled()
  })
})
