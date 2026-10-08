/**
 * Which `Range` headers the storage proxy passes on to the bucket.
 *
 * Only one well-formed byte range is passed on. Anything else is refused with
 * 416 by the caller rather than handed to S3, because S3 ignores a Range header
 * it cannot use and answers 200 with the whole object: a player asking for a
 * slice would be sent the full 100 MB, and the answer would look like success.
 */

/** `bytes=-N`: the last N bytes. */
const SUFFIX_RANGE = /^bytes=-(\d+)$/
/** `bytes=A-` or `bytes=A-B`: from A to the end, or from A to B. */
const RANGE_FROM_START = /^bytes=(\d+)-(\d*)$/

export function isSingleByteRange(value: string): boolean {
  const suffix = SUFFIX_RANGE.exec(value)
  if (suffix) {
    // `bytes=-0` asks for the last zero bytes, which no file can satisfy.
    return BigInt(suffix[1]) > 0n
  }

  const fromStart = RANGE_FROM_START.exec(value)
  if (!fromStart) return false
  const first = fromStart[1]
  const last = fromStart[2]
  const isOpenEnded = last === ''
  if (isOpenEnded) return true
  // Compared as BigInt: positions longer than 2^53 would compare wrongly as numbers.
  return BigInt(last) >= BigInt(first)
}
