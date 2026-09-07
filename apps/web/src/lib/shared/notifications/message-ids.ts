/**
 * Catalogue ids for the notification names, and the group headings beside
 * them.
 *
 * These sit in a module of their own rather than in `catalog.ts`, for two
 * reasons that point the same way. `catalog.ts` is upstream's data table, and
 * leaving it byte-identical is one fewer file to reconcile on every sync. And
 * the mutation gate grades whole files: declaring `catalog.ts` would put 25
 * rows of upstream metadata under a claim that the suite beside it holds
 * their behaviour, which it does not -- measured, as 57 surviving mutants of
 * `surfaces` and `label` fields no test asserts.
 *
 * The English stays in `catalog.ts` and is passed along as each id's
 * `defaultMessage`, so a reader whose language we do not ship still sees a
 * sentence (V6).
 */
// Type-only and erased at compile time, so this pulls no server module into
// the client bundle -- the same note `catalog.ts` carries for the same import.
import type { NotificationType } from '@/lib/server/domains/notifications/notification.types'
import type { NotificationGroup } from './catalog'

/** The heading each group of rows is shown under. It is the `defaultMessage`
 *  for the group ids below it, which is why it sits beside them rather than in
 *  `catalog.ts` with the row labels. */
export const NOTIFICATION_GROUP_LABELS: Record<NotificationGroup, string> = {
  feedback: 'Feedback',
  support: 'Support',
  changelog: 'Changelog',
}

export function notificationLabelId(type: NotificationType): string {
  return `notification.${type}.label`
}

export function notificationDescriptionId(type: NotificationType): string {
  return `notification.${type}.description`
}

export function notificationGroupId(group: NotificationGroup): string {
  return `notification.group.${group}`
}
