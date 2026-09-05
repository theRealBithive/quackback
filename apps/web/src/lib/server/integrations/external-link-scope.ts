/**
 * Which external links an inbound webhook may act on.
 *
 * An issue id is unique only inside its own container — GitLab hands out one
 * `iid` sequence per project, GitHub one number per repository. While an
 * instance targets a single project, `(integrationType, externalId)` is a safe
 * key. Once two boards route to two projects it is not: `#42` exists in both,
 * and a note from one product would land on the other product's post.
 *
 * `externalScope` is that container, recorded on the link when it is created.
 * It is NULL for links made before the column existed and for the providers
 * that do not report a container, so the rule has to stay useful without it
 * without ever guessing across a boundary.
 *
 * Guarantees V8 / V9 / V10 — see `__tests__/external-link-scope.test.ts`.
 */

/** A link row reduced to what this rule reads. */
export interface ScopedLink {
  /** The container the external item lives in; NULL when not recorded. */
  externalScope: string | null
}

/**
 * The links the caller may act on, given the container the webhook reported.
 *
 * Returns several rows on purpose: one external issue can back several
 * tickets. Returns none when the answer would be a guess.
 */
export function selectLinksForScope<T extends ScopedLink>(
  rows: readonly T[],
  reportedScope: string | undefined
): T[] {
  if (reportedScope === undefined) {
    // The provider named no container. Acting is safe only while every
    // candidate agrees on one — which is the case for every provider that has
    // never recorded a scope, and keeps their behaviour unchanged (V10).
    const scopes = new Set(rows.map((row) => row.externalScope))
    if (scopes.size > 1) return []
    return [...rows]
  }

  const fromReportedScope = rows.filter((row) => row.externalScope === reportedScope)
  if (fromReportedScope.length > 0) return fromReportedScope

  // No link records this container. A link with no container at all may still
  // be the right one — but only while nothing contradicts it. A link from a
  // container we *can* name proves this id is not unique across containers,
  // and picking the unscoped one would be the cross-product leak V8 forbids.
  const unscoped = rows.filter((row) => row.externalScope === null)
  const everyLinkIsUnscoped = unscoped.length === rows.length
  if (!everyLinkIsUnscoped) return []
  return unscoped
}
