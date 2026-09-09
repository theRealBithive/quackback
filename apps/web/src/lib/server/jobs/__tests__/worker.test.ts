/**
 * The job worker starts one always-on poll loop per workspace and does not
 * detach it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const POLL_MS = 50
const REAP_MS = POLL_MS * 4
const PRUNE_MS = REAP_MS * 10
const WORKSPACE_KEY = 'job_loop_ws'

const workspace = {
  workspaceKey: WORKSPACE_KEY,
  revision: 1,
  database: {
    directUrl: `postgres://direct/${WORKSPACE_KEY}`,
    pooledUrl: `postgres://pooled/${WORKSPACE_KEY}`,
  },
}

interface ClaimPlan {
  claimed: number
  /** `prune` flag of every `runMaintenanceTick` call, in order, when provided. */
  maintenance?: boolean[]
}

async function bootJobWorker(plan: ClaimPlan) {
  vi.resetModules()
  const savedPoll = process.env.JOB_POLL_INTERVAL_MS
  process.env.JOB_POLL_INTERVAL_MS = String(POLL_MS)

  vi.doMock('@/lib/server/process-role', () => ({ shouldRunWorkers: () => true }))
  vi.doMock('@/lib/server/config', () => ({
    config: { isPooledTenancy: true, databaseUrl: 'postgres://direct/single' },
  }))
  vi.doMock('@/lib/server/workspaces/registry', () => ({
    listActiveWorkspaces: async () => ({ workspaces: [workspace], refused: [] }),
  }))
  vi.doMock('@/lib/server/workspaces/fleet', () => ({
    withWorkspaceScopeById: async (_id: string, _origin: string, body: () => Promise<unknown>) =>
      body(),
  }))
  vi.doMock('@/lib/server/events/event-dispatch-queue', () => ({
    convertRelayOwnedEvents: async () => ({ converted: 0, enqueued: 0 }),
  }))
  vi.doMock('../runner', () => ({
    primeJobHandlers: async () => {},
    resetJobHandlers: () => {},
    runnerConfig: () => ({
      pollIntervalMs: POLL_MS,
      batchSize: 5,
      reapIntervalMs: REAP_MS,
      pruneIntervalMs: PRUNE_MS,
      retentionMs: 7 * 24 * 60 * 60 * 1000,
      maxConcurrency: 4,
    }),
    createJobPool: () => ({}),
    poolSize: () => 0,
    createScheduleState: () => ({}),
    runScheduleTick: async () => ({ enqueued: 0, attempted: 0, nextSlotAt: null }),
    runMaintenanceTick: async (_config: unknown, opts: { prune?: boolean } = {}) => {
      plan.maintenance?.push(opts.prune !== false)
      return { requeued: 0, terminated: 0, pruned: 0 }
    },
    dispatchPass: async () => ({ claimed: plan.claimed, saturated: true }),
    runJob: async () => 'succeeded',
    awaitPool: async () => {},
  }))

  const mod = await import('../worker')
  await mod.startJobWorker()
  await vi.advanceTimersByTimeAsync(0)

  return {
    status: () => {
      const row = mod.getJobWorkerStatus().workspaces.find((t) => t.workspaceKey === WORKSPACE_KEY)
      if (!row) throw new Error('job loop missing from status')
      return row
    },
    stop: async () => {
      await mod.stopJobWorker()
      vi.resetModules()
      if (savedPoll === undefined) delete process.env.JOB_POLL_INTERVAL_MS
      else process.env.JOB_POLL_INTERVAL_MS = savedPoll
    },
  }
}

let handle: Awaited<ReturnType<typeof bootJobWorker>> | null = null

afterEach(async () => {
  if (handle) {
    await handle.stop()
    handle = null
  }
  vi.useRealTimers()
})

describe('pooled job worker', () => {
  it('starts a loop per workspace and keeps polling', async () => {
    vi.useFakeTimers()
    const plan = { claimed: 0 }
    handle = await bootJobWorker(plan)
    expect(handle.status().passes).toBeGreaterThanOrEqual(1)

    const before = handle.status().passes
    plan.claimed = 2
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)
    expect(handle.status().passes).toBeGreaterThan(before)
    expect(handle.status().claimed).toBeGreaterThanOrEqual(2)
  })

  it('reaps leases on the reap clock and prunes only on the slower prune clock', async () => {
    // Retention is measured in days; pruning on every reap tick scans every
    // workspace's terminal rows for nothing. Only the first tick of each prune
    // window carries the flag.
    vi.useFakeTimers()
    const plan: ClaimPlan = { claimed: 0, maintenance: [] }
    handle = await bootJobWorker(plan)
    expect(plan.maintenance).toEqual([true])

    await vi.advanceTimersByTimeAsync(PRUNE_MS - REAP_MS)
    const withinWindow = plan.maintenance!.slice(1)
    expect(withinWindow.length).toBeGreaterThanOrEqual(2)
    expect(withinWindow.every((prune) => prune === false)).toBe(true)

    await vi.advanceTimersByTimeAsync(REAP_MS * 2)
    expect(plan.maintenance!.filter(Boolean)).toHaveLength(2)
  })

  it('does not start the job worker on a web replica', async () => {
    vi.resetModules()
    vi.doMock('@/lib/server/process-role', () => ({ shouldRunWorkers: () => false }))
    vi.doMock('@/lib/server/config', () => ({
      config: { isPooledTenancy: true, databaseUrl: 'postgres://direct/single' },
    }))
    const mod = await import('../worker')
    await mod.startJobWorker()
    expect(mod.getJobWorkerStatus()).toEqual({ running: false, workspaces: [] })
    vi.resetModules()
  })
})
