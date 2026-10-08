/**
 * Contract (batch I, confirmed 2026-10-08). Tests name these as I-R1 ... I-R7:
 * the fork already uses R1-R13 for the session audience guarantees
 * (auth-scope.test.ts), so the batch prefix keeps the two lists apart. The
 * list itself is verbatim.
 *
 * R1 Every event a reaction listens to (a new message, a conversation or ticket status change, a CSAT answer) gets its reactions run, however the event was produced.
 * R2 The reactions are recorded in the same transaction as the event: if the event commits, its reactions will run; if it rolls back, none run.
 * R3 Each reaction runs once per event in effect. A retry or a duplicate run never pauses, resumes or settles an SLA clock twice, never reopens a pair ticket twice, never writes a second summary.
 * R4 A reaction that fails is retried, and its failure never undoes or blocks the change that caused the event, nor holds back the other reactions of the same event.
 * R5 A failing delivery to an outbound target (webhook, integration) never delays or spends the reactions.
 * R6 A close summary, which may wait on a slow AI call, never delays the SLA and reopen reactions of other events.
 * R7 Rolling back to a build without the reaction queues loses no reaction silently: the runbook in JOBS.md states how to drain or purge them, and its SQL runs against the real schema.
 *
 * generateEmbedding hands its caller's abort signal to the provider request,
 * so a job past its deadline does not leave the request running. Real
 * provider client, real retry and usage logging (rolled back), against a local
 * server that accepts the request and never answers.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createDbTestFixture } from '@/lib/server/__tests__/db-test-fixture'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
const provider = vi.hoisted(() => ({ baseUrl: '' }))
vi.mock('@/lib/server/config', () => ({
  config: {
    openaiApiKey: 'test-key',
    get openaiBaseUrl() {
      return provider.baseUrl
    },
  },
}))
vi.mock('@/lib/server/domains/ai/models', () => ({
  getEmbeddingModel: () => 'test-embedding-model',
}))

import { generateEmbedding } from '../embedding.service'

const fixture = await createDbTestFixture()
afterAll(() => fixture.close())

describe.skipIf(!fixture.available)('generateEmbedding and its abort signal', () => {
  let server: Server
  let received: () => void
  let requested: Promise<void>
  let closed: () => void
  let requestClosed: Promise<void>

  // One server for the whole file: the provider client is created once per
  // process and keeps the first base URL it was given.
  beforeAll(async () => {
    // Accepts every request and never answers, as a stalled provider does.
    server = createServer((request) => {
      request.on('close', () => closed())
      received()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    provider.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  })
  afterAll(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  beforeEach(async () => {
    requested = new Promise((resolve) => (received = resolve))
    requestClosed = new Promise((resolve) => (closed = resolve))
    await fixture.begin()
  })
  afterEach(async () => {
    await fixture.rollback()
    server.closeAllConnections()
  })

  it('cancels the provider request when the signal aborts, and returns null (I-R6)', async () => {
    const deadline = new AbortController()
    const run = generateEmbedding(
      'Customer was double-charged; refunded.',
      { pipelineStep: 'assistant_summary_embedding' },
      { signal: deadline.signal }
    )
    await requested
    deadline.abort(new Error('event reactions passed their deadline'))

    await expect(run).resolves.toBeNull()
  }, 5_000)

  it('cancels the provider request without usage logging too (I-R6)', async () => {
    const deadline = new AbortController()
    const run = generateEmbedding('Customer was double-charged; refunded.', undefined, {
      signal: deadline.signal,
    })
    await requested
    deadline.abort(new Error('event reactions passed their deadline'))

    await expect(run).resolves.toBeNull()
    // The provider saw its request go away rather than run on unanswered.
    await requestClosed
  }, 5_000)
})
