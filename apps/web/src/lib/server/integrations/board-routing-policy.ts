/**
 * The stored shape of board→project routing, and the rules for reading it.
 *
 * A rule is one row in `integration_event_mappings`. The board is the row's
 * `targetKey`, the project its `actionConfig.channelId`, and `filters` carries
 * the board again plus the statuses that trigger it. Keying on the board is
 * what makes "a board points at at most one project" a database constraint
 * rather than a hope: `mapping_unique` covers (actionType, eventType,
 * integrationId, targetKey). Keyed on the project instead, two boards sharing
 * a project would share one row, and the second board's trigger statuses would
 * overwrite the first's.
 *
 * Everything here is pure. The server functions around it do the writing.
 */

/**
 * One stored mapping row, reduced to what these rules read.
 *
 * `actionConfig` is jsonb, so `channelId` is whatever was written there — the
 * column's own type allows a number or a boolean. It is read as `unknown` and
 * narrowed once, rather than trusted.
 */
export interface StoredMappingWithConfig {
  targetKey: string
  // The index signature is what lets the stored `EventMappingActionConfig`
  // pass: a target type with none but optional properties is a "weak type",
  // and TypeScript refuses a value that shares no property name with it.
  actionConfig: { channelId?: unknown; [key: string]: unknown } | null
  filters: { boardIds?: string[]; statusIds?: string[] } | null
}

/** A board→project routing rule, as the settings page edits it. */
export interface BoardRoutingRule {
  boardId: string
  projectId: string
  triggerStatusIds: string[]
}

/**
 * The rule a stored row expresses, or null when it does not express one.
 *
 * All four parts have to be there, and the fourth is the one worth naming: a
 * row with no `actionConfig.channelId` is not an inert half-rule. The resolver
 * falls back to the instance-wide project when a matched mapping names none,
 * so such a row quietly routes its board into whatever project the integration
 * pointed at before per-board routing existed.
 *
 * The key and the board filter have to agree because the rest of the code
 * reads one or the other. A row where they differ belongs to neither board,
 * and picking one would be a guess that lands a product's feedback in another
 * product's tracker.
 */
function projectIdOf(row: StoredMappingWithConfig): string | null {
  const stored = row.actionConfig?.channelId
  if (typeof stored !== 'string' || stored.length === 0) return null
  return stored
}

function completeRuleOf(row: StoredMappingWithConfig): BoardRoutingRule | null {
  const projectId = projectIdOf(row)
  if (projectId === null) return null

  const statusIds = row.filters?.statusIds
  if (!statusIds?.length) return null

  // One row, one board: that is what makes the row's key meaningful, and it is
  // what `mapping_unique` turns into "a board points at at most one project".
  const boardIds = row.filters?.boardIds
  if (boardIds?.length !== 1) return null
  if (boardIds[0] !== row.targetKey) return null

  return { boardId: row.targetKey, projectId, triggerStatusIds: statusIds }
}

/**
 * The `targetKey`s whose rows have to be deleted before routing is correct.
 *
 * Anything that is not a complete rule. The row every instance has today is
 * the reason: no filter at all, so it matches every board and falls back to
 * the instance-wide project. It does not stop being a catch-all because
 * per-board rules exist alongside it — the resolver matches it first and
 * independently, so every post would fan out twice.
 */
export function targetKeysToRetire(stored: StoredMappingWithConfig[]): string[] {
  const keys: string[] = []
  for (const row of stored) {
    if (completeRuleOf(row) !== null) continue
    if (keys.includes(row.targetKey)) continue
    keys.push(row.targetKey)
  }
  return keys
}

/** The stored rows read back as rules, for the settings page. */
export function rulesFromMappings(stored: StoredMappingWithConfig[]): BoardRoutingRule[] {
  const rules: BoardRoutingRule[] = []
  for (const row of stored) {
    const rule = completeRuleOf(row)
    if (rule !== null) rules.push(rule)
  }
  return rules
}

// ============================================
// The filters the event resolver applies
// ============================================

/** A mapping's filters, as the resolver hands them over. */
export interface MappingFilters {
  boardIds?: string[]
  statusIds?: string[]
}

/**
 * A mapping that names statuses is a per-board routing rule: it says which
 * project this one board's issues belong in. Nothing else writes `statusIds`,
 * which is what makes it a safe discriminator — chat mappings are unaffected
 * by everything that keys off it.
 */
export function isBoardRoutingRule(filters: MappingFilters | null): boolean {
  return (filters?.statusIds?.length ?? 0) > 0
}

/**
 * Whether a mapping's board filter lets an event through.
 *
 * No board filter matches every board — that is how one chat channel
 * subscribes to a whole instance. A board filter matches when the event names
 * one of its boards.
 *
 * The third case is the one that matters. An event that names no board at all
 * passes every board filter, and for chat that is deliberate: a conversation
 * or ticket event has no board, and a channel filtered to a board should keep
 * receiving them. A routing rule must not get that exception. It names the one
 * project this board's issues belong in, so "no board" would mean "every
 * project" — one post opening an issue in every product's tracker, which is
 * what the code did before this function existed.
 */
export function boardFilterAllows(filters: MappingFilters | null, boardIds: string[]): boolean {
  const declared = filters?.boardIds
  if (!declared?.length) return true
  if (boardIds.some((id) => declared.includes(id))) return true
  if (isBoardRoutingRule(filters)) return false
  return boardIds.length === 0
}

/**
 * Whether a mapping's status filter lets an event through.
 *
 * Only a routing rule declares one, and it decides *when* an issue is created:
 * on reaching a triage status, not on the post arriving. An unknown status is
 * not a wildcard — a rule that names statuses and cannot see one matches
 * nothing.
 *
 * The value compared is the status **id**, read from the post row. The event
 * payload carries the status *name*, and matching on that would mean renaming
 * a status silently stops a board from creating issues.
 */
export function statusFilterAllows(
  filters: MappingFilters | null,
  statusId: string | undefined
): boolean {
  const declared = filters?.statusIds
  if (!declared?.length) return true
  if (!statusId) return false
  return declared.includes(statusId)
}
