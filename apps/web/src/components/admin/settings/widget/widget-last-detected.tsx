import { TimeAgo } from '@/components/ui/time-ago'
import { NUMERIC_DATE_TIME, useLocalDateFormatter } from '@/components/ui/local-date'

/** Relative “Last detected …” line for the widget install ping. */
export function WidgetLastDetected({ at }: { at?: string | null }) {
  const formatDate = useLocalDateFormatter()
  if (!at) return null
  const parsed = new Date(at)
  if (Number.isNaN(parsed.getTime())) return null
  return (
    <p className="text-xs text-muted-foreground" title={formatDate(parsed, NUMERIC_DATE_TIME)}>
      Last detected <TimeAgo date={at} locale="en" />
    </p>
  )
}
