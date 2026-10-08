/**
 * Generators for the containers batch H's upload check has to tell apart.
 *
 * They build structurally valid headers rather than random bytes: random bytes
 * only ever reach the "unidentifiable" branch. Each generator says which state
 * of the sniffer it reaches:
 *
 * - `isoMediaVideo`: an ISO base media `ftyp` box whose brands are all video
 *   brands (MP4, MOV, M4V, DASH, …) — the accepted MP4 family.
 * - `isoMediaImage`: the same box carrying an AVIF or HEIC brand, either as the
 *   major brand or only among the compatible brands behind a profile major
 *   brand — the two places a real still image names itself.
 * - `ebmlDocument`: an EBML header with a DocType element, `webm` or
 *   `matroska`, its sibling elements in any order and its sizes written in
 *   any of the eight widths EBML allows.
 * - `ebmlWithoutDocType`: an EBML header that names no DocType.
 * - `rasterImage`: the magic of one of the accepted still-image formats.
 */
import fc from 'fast-check'

const VIDEO_BRANDS = [
  'isom',
  'iso2',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'M4VP',
  'M4VH',
  'qt  ',
  'dash',
  'msnv',
] as const

/** Brands a still image declares, AVIF and HEIC families. */
export const IMAGE_BRANDS = [
  'avif',
  'avis',
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
] as const

/** Profile brands an image may name as its major brand, its family only in the compatible list. */
const IMAGE_PROFILE_MAJOR_BRANDS = ['MA1B', 'MA1A', 'miaf'] as const

function ascii(text: string): number[] {
  const codes: number[] = []
  for (const character of text) codes.push(character.charCodeAt(0))
  return codes
}

function uint32BigEndian(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

/** An `ftyp` box: size, `ftyp`, major brand, minor version, compatible brands. */
export function ftypBox(majorBrand: string, compatibleBrands: readonly string[]): number[] {
  const size = 16 + 4 * compatibleBrands.length
  const box = [...uint32BigEndian(size), ...ascii('ftyp'), ...ascii(majorBrand), 0, 0, 0, 0]
  for (const brand of compatibleBrands) box.push(...ascii(brand))
  return box
}

const trailingBytes = fc.uint8Array({ minLength: 0, maxLength: 64 })

function withTrailer(header: fc.Arbitrary<number[]>): fc.Arbitrary<Buffer> {
  return fc
    .tuple(header, trailingBytes)
    .map(([head, tail]) => Buffer.from([...head, ...Array.from(tail)]))
}

export const isoMediaVideo: fc.Arbitrary<Buffer> = withTrailer(
  fc
    .tuple(
      fc.constantFrom(...VIDEO_BRANDS),
      fc.array(fc.constantFrom(...VIDEO_BRANDS), { maxLength: 4 })
    )
    .map(([major, compatible]) => ftypBox(major, compatible))
)

const imageBrandAsMajor = fc
  .tuple(
    fc.constantFrom(...IMAGE_BRANDS),
    fc.array(fc.constantFrom(...IMAGE_BRANDS, ...VIDEO_BRANDS), { maxLength: 4 })
  )
  .map(([major, compatible]) => ftypBox(major, compatible))

const imageBrandOnlyCompatible = fc
  .tuple(
    fc.constantFrom(...IMAGE_PROFILE_MAJOR_BRANDS),
    fc.array(fc.constantFrom(...VIDEO_BRANDS), { maxLength: 2 }),
    fc.constantFrom(...IMAGE_BRANDS),
    fc.array(fc.constantFrom(...VIDEO_BRANDS), { maxLength: 2 })
  )
  .map(([major, before, imageBrand, after]) => ftypBox(major, [...before, imageBrand, ...after]))

export const isoMediaImage: fc.Arbitrary<Buffer> = withTrailer(
  fc.oneof(imageBrandAsMajor, imageBrandOnlyCompatible)
)

/**
 * An EBML variable-length size of `width` bytes: the first byte carries a
 * marker bit at position `width`, the value fills the bits after it. Writers
 * may use any width that fits, so a reader has to handle all eight.
 */
export function ebmlSize(value: number, width: number): number[] {
  const bytes: number[] = []
  let rest = value
  for (let index = 0; index < width; index++) {
    bytes.unshift(rest % 256)
    rest = Math.floor(rest / 256)
  }
  bytes[0] = bytes[0] | (0x80 >> (width - 1))
  return bytes
}

/** An EBML element: id bytes, its size in `sizeWidth` bytes, then the payload. */
function ebmlElement(id: number[], payload: number[], sizeWidth = 1): number[] {
  return [...id, ...ebmlSize(payload.length, sizeWidth), ...payload]
}

export function ebmlHeader(docType: string, siblings: number[][] = [], sizeWidth = 1): number[] {
  const docTypeElement = ebmlElement([0x42, 0x82], ascii(docType), sizeWidth)
  const body = [...siblings.flat(), ...docTypeElement]
  return [0x1a, 0x45, 0xdf, 0xa3, ...ebmlSize(body.length, sizeWidth), ...body]
}

const EBML_SIBLINGS: number[][] = [
  ebmlElement([0x42, 0x86], [1]), // EBMLVersion
  ebmlElement([0x42, 0xf7], [1]), // EBMLReadVersion
  ebmlElement([0x42, 0xf2], [4]), // EBMLMaxIDLength
  ebmlElement([0x42, 0xf3], [8]), // EBMLMaxSizeLength
  ebmlElement([0x42, 0x87], [4]), // DocTypeVersion
  ebmlElement([0x42, 0x85], [2]), // DocTypeReadVersion
]

/** An EBML header whose sizes are written in one to eight bytes, siblings in any order. */
export function ebmlDocument(docType: 'webm' | 'matroska'): fc.Arbitrary<Buffer> {
  return withTrailer(
    fc
      .tuple(fc.shuffledSubarray(EBML_SIBLINGS), fc.integer({ min: 1, max: 8 }))
      .map(([siblings, sizeWidth]) => ebmlHeader(docType, siblings, sizeWidth))
  )
}

/** An EBML header carrying only the given siblings, and no DocType at all. */
export const ebmlWithoutDocType: fc.Arbitrary<Buffer> = withTrailer(
  fc.shuffledSubarray(EBML_SIBLINGS).map((siblings) => {
    const body = siblings.flat()
    return [0x1a, 0x45, 0xdf, 0xa3, ...ebmlSize(body.length, 1), ...body]
  })
)

const RASTER_MAGIC: Record<string, number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0],
  'image/gif': ascii('GIF89a').concat([0, 0]),
  'image/webp': [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')],
}

export const RASTER_IMAGE_TYPES = Object.keys(RASTER_MAGIC)

export function rasterImage(type: string): fc.Arbitrary<Buffer> {
  return withTrailer(fc.constant(RASTER_MAGIC[type]))
}

export const anyRasterImage: fc.Arbitrary<{ type: string; bytes: Buffer }> = fc
  .constantFrom(...RASTER_IMAGE_TYPES)
  .chain((type) => rasterImage(type).map((bytes) => ({ type, bytes })))
