/**
 * Shared storage configuration constants.
 * Client-safe subset of lib/server/storage/s3 — no AWS SDK or node:crypto deps.
 */

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
])

const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v',
  'video/m4v',
])

/** File-picker filter for the video containers the direct-upload path accepts. */
export const VIDEO_FILE_ACCEPT = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v',
  '.mp4',
  '.webm',
  '.mov',
  '.m4v',
].join(',')

/** Validate that a file is an allowed image type. */
export function isAllowedImageType(contentType: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(contentType)
}

/** Video formats that play natively across the supported portal browsers. */
export function isAllowedVideoType(contentType: string): boolean {
  return ALLOWED_VIDEO_TYPES.has(contentType)
}

const VIDEO_TYPE_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
}

const IMAGE_TYPE_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
}

/** A type a file picker leaves behind when it does not know the file's. */
function isGenericType(contentType: string): boolean {
  return contentType === '' || contentType === 'application/octet-stream'
}

function lowerCaseExtension(filename: string): string | null {
  const match = filename.toLowerCase().match(/\.([^.]+)$/)
  if (!match) return null
  return match[1]
}

function typeByExtension(table: Record<string, string>, filename: string): string | null {
  const extension = lowerCaseExtension(filename)
  if (extension === null || !Object.hasOwn(table, extension)) return null
  return table[extension]
}

/**
 * Resolve video MIME types omitted by some desktop file pickers. The server
 * still verifies the file's container signature before storing it.
 */
export function resolveVideoMimeType(contentType: string, filename: string): string | null {
  if (isAllowedVideoType(contentType)) return contentType
  if (!isGenericType(contentType)) return null
  return typeByExtension(VIDEO_TYPE_BY_EXTENSION, filename)
}

/**
 * The type an image or video upload is judged as: the declared type when it is
 * an accepted one, otherwise — only for a missing or generic type — the type
 * its extension names. The bytes are still checked against the result.
 */
export function resolveMediaMimeType(contentType: string, filename: string): string | null {
  if (isAllowedImageType(contentType)) return contentType
  if (isAllowedVideoType(contentType)) return contentType
  if (!isGenericType(contentType)) return null
  const videoType = typeByExtension(VIDEO_TYPE_BY_EXTENSION, filename)
  if (videoType) return videoType
  return typeByExtension(IMAGE_TYPE_BY_EXTENSION, filename)
}

/** MIME value used by the HTML video element after persisted attrs are sanitized. */
export function normalizeVideoMimeType(contentType: unknown): string {
  if (contentType === 'video/webm') return 'video/webm'
  if (contentType === 'video/quicktime') return 'video/quicktime'
  return 'video/mp4'
}

export function isAllowedMediaType(contentType: string): boolean {
  return isAllowedImageType(contentType) || isAllowedVideoType(contentType)
}

/** Maximum allowed file size in bytes (5MB). */
export const MAX_FILE_SIZE = 5 * 1024 * 1024

/** Native feedback recordings may be larger than screenshots. */
export const MAX_VIDEO_FILE_SIZE = 100 * 1024 * 1024

export function maxMediaFileSize(contentType: string): number {
  return isAllowedVideoType(contentType) ? MAX_VIDEO_FILE_SIZE : MAX_FILE_SIZE
}
