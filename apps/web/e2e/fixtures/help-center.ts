/**
 * The help-center rows `e2e/scripts/set-help-center.ts` provisions, shared with
 * the specs that read them. Kept apart from the script because importing the
 * script would run it.
 */
export const HELP_CENTER_FIXTURE = {
  categorySlug: 'e2e-help-center',
  categoryName: 'E2E Help Center',
  categoryDescription: 'Articles the e2e suite reads',
  firstArticleSlug: 'e2e-getting-started',
  firstArticleTitle: 'E2E Getting started',
  firstArticleHeadings: ['First step', 'Second step'],
  secondArticleSlug: 'e2e-second-steps',
  secondArticleTitle: 'E2E Second steps',
} as const
