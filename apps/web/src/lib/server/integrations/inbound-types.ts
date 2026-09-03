/**
 * Inbound webhook handler interface.
 *
 * Each integration that supports inbound status sync implements this interface.
 * The central orchestrator calls verifySignature, then parseStatusChange,
 * then looks up the post and updates its status.
 */

/**
 * Result of parsing an inbound webhook payload.
 */
export interface InboundWebhookResult {
  /** The external issue ID that changed status */
  externalId: string
  /** The new status name from the external platform */
  externalStatus: string
  /** Event type for logging (e.g. 'issue.updated', 'taskStatusUpdated') */
  eventType: string
  /**
   * Semantic open/closed transition, when the provider payload states it
   * outright (GitHub's `action: closed|reopened`). Most providers only report
   * a workflow-state change with a status name, so this stays undefined and
   * downstream copy falls back to naming the new status. Optional by design —
   * do NOT derive it heuristically from status names.
   */
  transition?: 'closed' | 'reopened'
}

/**
 * A comment written on the external issue, on its way in as a post comment.
 *
 * Separate from `InboundWebhookResult` because the two carry different ids:
 * a status change only ever names the issue, while a comment additionally
 * needs a stable handle for the comment itself so a redelivered webhook does
 * not post it twice.
 */
export interface InboundCommentResult {
  /** The external ISSUE id — matches `post_external_links.externalId`. */
  externalId: string
  /** Provider-stable id of the comment itself; the redelivery dedupe handle. */
  externalCommentId: string
  /** Display name of whoever wrote it on the provider side. Never an email. */
  authorName: string
  /** The comment text, verbatim. */
  body: string
}

/**
 * Handler interface for inbound webhooks from external platforms.
 */
export interface InboundWebhookHandler {
  /**
   * Verify the webhook signature/authenticity.
   * Returns `true` if valid, or a `Response` for handshake challenges or auth failures.
   */
  verifySignature(request: Request, body: string, secret: string): Promise<true | Response>

  /**
   * Parse the webhook body and extract a status change, if any.
   * Returns null for events we don't care about (acknowledged but ignored).
   */
  parseStatusChange(
    body: string,
    config: Record<string, unknown>,
    secrets: Record<string, unknown>
  ): Promise<InboundWebhookResult | null>

  /**
   * Parse the webhook body and extract a comment written on the external
   * issue, if any. Returns null for everything else — including the
   * provider's own bookkeeping notes, which are not something a person wrote.
   *
   * Optional: a provider that has no comment sync simply omits it, and the
   * orchestrator then only runs the status branch.
   */
  parseComment?(
    body: string,
    config: Record<string, unknown>,
    secrets: Record<string, unknown>
  ): Promise<InboundCommentResult | null>
}
