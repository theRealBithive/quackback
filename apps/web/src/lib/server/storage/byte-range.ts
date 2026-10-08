/**
 * Which `Range` headers the storage proxy passes on to the bucket.
 *
 * Only one well-formed byte range is passed on. Anything else is refused with
 * 416 by the caller rather than handed to S3, because S3 ignores a Range header
 * it cannot use and answers 200 with the whole object: a player asking for a
 * slice would be sent the full 100 MB, and the answer would look like success.
 */

const SINGLE_BYTE_RANGE = /^bytes=(\d*)-(\d*)$/

export function isSingleByteRange(value: string): boolean {
  const match = SINGLE_BYTE_RANGE.exec(value)
  if (!match) return false
  const first = match[1]
  const last = match[2]
  if (first === '' && last === '') return false

  const isSuffixRange = first === ''
  if (isSuffixRange) {
    // `bytes=-0` asks for the last zero bytes, which no file can satisfy.
    return BigInt(last) > 0n
  }

  const isOpenEnded = last === ''
  if (isOpenEnded) return true
  // Compared as BigInt: positions longer than 2^53 would compare wrongly as numbers.
  return BigInt(last) >= BigInt(first)
}
