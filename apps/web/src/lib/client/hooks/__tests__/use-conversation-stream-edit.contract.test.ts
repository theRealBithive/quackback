// @vitest-environment happy-dom
/**
 * Edit frames reach the open threads through the stream hook.
 *
 * Contract for the batch G pick (upstream ccf8f0521 #580, "edit and delete your
 * own support messages") -- the confirmed list item this suite pins (verbatim):
 *
 *   G4 An edit to a customer-visible message reaches the customer's widget and the ticket thread live; an edit to an internal note never reaches the customer.
 *
 * A named SSE frame with no listener is dropped by the browser, so the two
 * frames an edit rides on are delivered here the way the browser would: by name,
 * with a JSON body, and the hook must hand the parsed event on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useConversationStream } from '../use-conversation-stream'

class NamedFrameEventSource {
  static instances: NamedFrameEventSource[] = []
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  private listeners = new Map<string, (event: MessageEvent) => void>()

  constructor(readonly url: string) {
    NamedFrameEventSource.instances.push(this)
  }

  addEventListener(name: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(name, listener)
  }

  /** Deliver a frame; a frame whose name has no listener is dropped, like a browser does. */
  deliver(name: string, payload: unknown) {
    this.listeners.get(name)?.({ data: JSON.stringify(payload) } as MessageEvent)
  }
}

beforeEach(() => {
  NamedFrameEventSource.instances = []
  vi.stubGlobal('EventSource', NamedFrameEventSource as unknown as typeof EventSource)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function connect(onEvent: (event: unknown) => void) {
  renderHook(() =>
    useConversationStream({ buildUrl: async () => '/api/chat/stream', enabled: true, onEvent })
  )
  await act(async () => {})
  return NamedFrameEventSource.instances[0]
}

describe('useConversationStream delivers edit frames (G4)', () => {
  it('hands a message_edited frame, as the customer receives an edit, to the thread (G4)', async () => {
    const onEvent = vi.fn()
    const source = await connect(onEvent)
    const frame = {
      kind: 'message_edited',
      conversationId: 'conversation_1',
      message: { id: 'conversation_msg_1', content: 'new', editedAt: '2026-07-02T12:00:00.000Z' },
    }

    source.deliver('message_edited', frame)

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith(frame)
  })

  it('hands a ticket_message_updated frame to the ticket thread (G4)', async () => {
    const onEvent = vi.fn()
    const source = await connect(onEvent)
    const frame = {
      kind: 'ticket_message_updated',
      ticketId: 'ticket_1',
      message: { id: 'conversation_msg_1', content: 'new', editedAt: '2026-07-02T12:00:00.000Z' },
    }

    source.deliver('ticket_message_updated', frame)

    expect(onEvent).toHaveBeenCalledWith(frame)
  })
})
