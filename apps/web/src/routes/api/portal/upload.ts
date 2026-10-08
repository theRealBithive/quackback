import { createFileRoute } from '@tanstack/react-router'
import type { UserId } from '@quackback/ids'
import { auth } from '@/lib/server/auth'
import { db, eq, principal } from '@/lib/server/db'
import { getClientIp } from '@/lib/server/domains/api/rate-limit'
import { workspaceAllowsAnonymous } from '@/lib/server/domains/settings/settings.types'
import { getSettings } from '@/lib/server/functions/workspace'
import { isS3Configured, uploadMediaFromFormData } from '@/lib/server/storage/s3'
import {
  incrementBucket,
  bucketRetryAfter,
  type RateBucketSpec,
} from '@/lib/server/utils/rate-bucket'

const UPLOAD_WINDOW_SECONDS = 60
const UPLOADS_PER_SESSION = 20
/**
 * An anonymous session costs nothing to mint, so the per-session limit alone
 * does not bound what one client can upload. Ten 100 MB videos a minute from
 * one address is 1 GB, half of what a single session may send.
 */
const ANONYMOUS_UPLOADS_PER_ADDRESS = 10

/** The 429 for a bucket over its limit, or null when the request may proceed. */
async function refuseOverLimit(bucket: RateBucketSpec, limit: number): Promise<Response | null> {
  const { count } = await incrementBucket(bucket)
  // A null count is a store outage, which fails open like every other bucket.
  if (count === null || count <= limit) return null
  const retryAfter = await bucketRetryAfter(bucket)
  return Response.json(
    { error: 'Too many uploads, slow down' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  )
}

/** Whether this workspace lets anonymous visitors post, read on the server. */
async function workspaceLetsAnonymousVisitorsPost(): Promise<boolean> {
  const settings = await getSettings()
  return workspaceAllowsAnonymous(settings?.portalConfig)
}

export async function handlePortalUpload({ request }: { request: Request }): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const principalRecord = await db.query.principal.findFirst({
    where: eq(principal.userId, session.user.id as UserId),
    columns: { type: true },
  })
  if (!principalRecord) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const isAnonymous = principalRecord.type === 'anonymous'
  if (isAnonymous && !(await workspaceLetsAnonymousVisitorsPost())) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sessionBucket = {
    key: `portal-upload:user:${session.user.id}`,
    windowSeconds: UPLOAD_WINDOW_SECONDS,
  }
  const sessionRefusal = await refuseOverLimit(sessionBucket, UPLOADS_PER_SESSION)
  if (sessionRefusal) return sessionRefusal

  if (isAnonymous) {
    const addressBucket = {
      key: `portal-upload:ip:${getClientIp(request)}`,
      windowSeconds: UPLOAD_WINDOW_SECONDS,
    }
    const addressRefusal = await refuseOverLimit(addressBucket, ANONYMOUS_UPLOADS_PER_ADDRESS)
    if (addressRefusal) return addressRefusal
  }

  if (!isS3Configured()) {
    return Response.json({ error: 'Storage not configured' }, { status: 503 })
  }
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }
  return uploadMediaFromFormData(formData, 'portal-media')
}

export const Route = createFileRoute('/api/portal/upload')({
  server: {
    handlers: {
      POST: handlePortalUpload,
    },
  },
})
