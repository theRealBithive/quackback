/**
 * What to show the user when something they did failed.
 *
 * A rejected server function does not have to reject with an `Error`, and an
 * `Error` can carry an empty message. Both used to reach the toast as a message
 * saying nothing — a toast the user sees appear and cannot read.
 */
export function failureMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message
  return fallback
}
