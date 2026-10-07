import type { EditorFeatures } from '@/components/ui/rich-text-editor'

/**
 * The blocks the portal's "submit feedback" editor offers, images aside (those
 * depend on whether the visitor may upload). Description templates are limited
 * to this set, because a block the portal editor lacks would be dropped here
 * while the widget and the admin dialog kept it.
 */
export const PORTAL_POST_EDITOR_FEATURES: EditorFeatures = {
  headings: true,
  quackbackEmbeds: true,
}
