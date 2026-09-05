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
 * Whether a stored row is a complete routing rule.
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

function isCompleteRule(row: StoredMappingWithConfig): boolean {
  if (projectIdOf(row) === null) return false
  if (!row.filters?.statusIds?.length) return false
  const boardIds = row.filters.boardIds
  if (boardIds?.length !== 1) return false
  return boardIds[0] === row.targetKey
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
    if (isCompleteRule(row)) continue
    if (keys.includes(row.targetKey)) continue
    keys.push(row.targetKey)
  }
  return keys
}

/** The stored rows read back as rules, for the settings page. */
export function rulesFromMappings(stored: StoredMappingWithConfig[]): BoardRoutingRule[] {
  const rules: BoardRoutingRule[] = []
  for (const row of stored) {
    const projectId = projectIdOf(row)
    if (projectId === null) continue
    if (!isCompleteRule(row)) continue
    rules.push({
      boardId: row.targetKey,
      projectId,
      triggerStatusIds: row.filters?.statusIds ?? [],
    })
  }
  return rules
}
