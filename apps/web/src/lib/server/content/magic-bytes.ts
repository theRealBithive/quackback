/**
 * Image magic-byte sniffer for the content rehoster.
 *
 * Parses the first few bytes of a response body and returns the detected
 * MIME type only if it matches one of our allowed image formats. The caller
 * uses this to verify that a server-reported Content-Type header wasn't
 * spoofed: if `header !== sniffed` or `sniffed === null`, reject the image.
 *
 * SVG is deliberately never returned — even if the bytes look XML-ish, we
 * don't allow SVG because it can carry script payloads.
 */

export const ALLOWED_REHOST_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/x-icon',
])

const ISO_IMAGE_BRANDS = new Set([
  'avif',
  'avis',
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
])

/**
 * Map equivalent MIME spellings to the canonical form `sniffImageMime` returns,
 * so a header cross-check accepts e.g. `image/vnd.microsoft.icon` as `image/x-icon`.
 * Owns the alias vocabulary alongside the canonical set above.
 */
export function canonicalizeImageMime(mime: string): string {
  if (mime === 'image/vnd.microsoft.icon' || mime === 'image/icon' || mime === 'image/ico') {
    return 'image/x-icon'
  }
  return mime
}

function startsWithAt(buf: Buffer, offset: number, pattern: number[]): boolean {
  if (buf.length < offset + pattern.length) return false
  for (let i = 0; i < pattern.length; i++) {
    if (buf[offset + i] !== pattern[i]) return false
  }
  return true
}

/**
 * Sniff the image MIME type from the first ~16 bytes of the buffer.
 * Returns one of ALLOWED_REHOST_MIMES or null.
 */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 8) return null

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWithAt(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png'
  }
  // JPEG: FF D8 FF
  if (startsWithAt(buf, 0, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg'
  }
  // GIF: "GIF87a" or "GIF89a"
  if (buf.slice(0, 6).toString('ascii') === 'GIF87a') return 'image/gif'
  if (buf.slice(0, 6).toString('ascii') === 'GIF89a') return 'image/gif'
  // WebP: "RIFF" .... "WEBP"
  if (
    buf.length >= 12 &&
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  // AVIF: ...."ftyp""avif" or ...."ftyp""avis" at offset 4
  if (buf.length >= 12 && buf.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('ascii')
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
  }
  // ICO: 00 00 01 00
  if (startsWithAt(buf, 0, [0x00, 0x00, 0x01, 0x00])) {
    return 'image/x-icon'
  }
  return null
}

/**
 * Sniff the browser-playable video formats accepted by feedback uploads.
 *
 * MP4 is an ISO Base Media File Format container, identified by its `ftyp`
 * box. AVIF and HEIC use the same container, so a file naming any of their
 * brands is refused as a video. WebM is an EBML document whose DocType is `webm`;
 * Matroska carries the same magic with another DocType.
 */
export type SniffedVideoMime = 'video/mp4' | 'video/webm'

/** Canonical container family used when comparing a declared video MIME. */
export function canonicalizeVideoMime(mime: string): SniffedVideoMime | null {
  if (
    mime === 'video/mp4' ||
    mime === 'video/quicktime' ||
    mime === 'video/x-m4v' ||
    mime === 'video/m4v'
  ) {
    return 'video/mp4'
  }
  if (mime === 'video/webm') return 'video/webm'
  return null
}

/**
 * The brands an ISO media `ftyp` box declares: the major brand, then every
 * compatible brand inside the box. A still image may name its AVIF or HEIC
 * family only among the compatible brands, behind a profile major brand, so the
 * major brand alone does not say whether the file is an image.
 */
function isoMediaBrands(buf: Buffer): string[] {
  const declaredBoxSize = buf.readUInt32BE(0)
  const boxEnd = Math.min(declaredBoxSize, buf.length)
  const brands = [buf.toString('latin1', 8, 12)]
  const firstCompatibleBrand = 16
  for (let offset = firstCompatibleBrand; offset + 4 <= boxEnd; offset += 4) {
    brands.push(buf.toString('latin1', offset, offset + 4))
  }
  return brands
}

function isIsoMediaVideo(buf: Buffer): boolean {
  if (buf.length < 12) return false
  if (buf.toString('latin1', 4, 8) !== 'ftyp') return false
  const declaresAnImage = isoMediaBrands(buf).some((brand) => ISO_IMAGE_BRANDS.has(brand))
  return !declaresAnImage
}

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3]
const EBML_DOCTYPE_ID = 0x4282

/** Length in bytes of the EBML variable-length integer starting with `firstByte`, or 0. */
function ebmlVarIntLength(firstByte: number): number {
  for (let length = 1; length <= 8; length++) {
    const marker = 0x80 >> (length - 1)
    if (firstByte & marker) return length
  }
  return 0
}

/** Value of the variable-length integer at `offset`, its length marker removed. */
function readEbmlVarInt(buf: Buffer, offset: number, length: number): number {
  const marker = 0x80 >> (length - 1)
  let value = buf[offset] & (marker - 1)
  for (let index = 1; index < length; index++) {
    value = value * 256 + buf[offset + index]
  }
  return value
}

/** Element id at `offset`, the length marker kept (ids are written that way). */
function readEbmlId(buf: Buffer, offset: number, length: number): number {
  let id = 0
  for (let index = 0; index < length; index++) {
    id = id * 256 + buf[offset + index]
  }
  return id
}

/**
 * The DocType the EBML header at the start of `buf` declares, or null when the
 * header is cut short, malformed, or names none. Reads only inside the header.
 */
function ebmlDocType(buf: Buffer): string | null {
  if (!startsWithAt(buf, 0, EBML_MAGIC)) return null
  const headerSizeOffset = EBML_MAGIC.length
  if (buf.length <= headerSizeOffset) return null
  const headerSizeLength = ebmlVarIntLength(buf[headerSizeOffset])
  if (headerSizeLength === 0 || buf.length < headerSizeOffset + headerSizeLength) return null
  const headerStart = headerSizeOffset + headerSizeLength
  const headerSize = readEbmlVarInt(buf, headerSizeOffset, headerSizeLength)
  const headerEnd = headerStart + headerSize
  if (headerEnd > buf.length) return null

  let offset = headerStart
  while (offset < headerEnd) {
    const idLength = ebmlVarIntLength(buf[offset])
    if (idLength === 0 || idLength > 4) return null
    const sizeOffset = offset + idLength
    if (sizeOffset >= headerEnd) return null
    const sizeLength = ebmlVarIntLength(buf[sizeOffset])
    if (sizeLength === 0 || sizeOffset + sizeLength > headerEnd) return null
    const payloadStart = sizeOffset + sizeLength
    const payloadEnd = payloadStart + readEbmlVarInt(buf, sizeOffset, sizeLength)
    if (payloadEnd > headerEnd) return null
    if (readEbmlId(buf, offset, idLength) === EBML_DOCTYPE_ID) {
      return buf.toString('latin1', payloadStart, payloadEnd)
    }
    offset = payloadEnd
  }
  return null
}

export function sniffVideoMime(buf: Buffer): SniffedVideoMime | null {
  if (isIsoMediaVideo(buf)) return 'video/mp4'
  // Matroska shares the EBML magic with WebM; only the DocType tells them apart.
  if (ebmlDocType(buf) === 'webm') return 'video/webm'
  return null
}
