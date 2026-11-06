/**
 * Which admin pages let the layout open the feedback post modal for `?post=`.
 *
 * The roadmap renders its own post modal for the same search param. Opening
 * both stacks two modal dialogs, and each marks the other aria-hidden, so
 * neither is reachable for a keyboard or screen-reader user. Ported from the
 * roadmap half of upstream #563.
 */
export function layoutOpensPostModal(pathname: string): boolean {
  const onRoadmap = pathname === '/admin/roadmap' || pathname.startsWith('/admin/roadmap/')
  return !onRoadmap
}
