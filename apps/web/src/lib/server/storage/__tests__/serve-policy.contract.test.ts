/**
 * What a stored file may do when a browser opens it: the serving policy.
 *
 * Contract for upstream batch F (#608, `d166bf7ee`) — the confirmed list for
 * this area:
 *
 *   F23 A stored file opens in the browser only if its stored type is a raster
 *       image, audio, video or PDF; everything else, HTML and SVG included, is
 *       served as a download under a sandbox policy.
 *   F24 A download carries the file's own name, not the storage id.
 *   F25 A redirect to object storage follows the same rule as F23, decided from
 *       the file's extension.
 *   F26 Images and videos embedded in pages keep rendering.
 *
 * The route-level half of the same contract is in
 * `routes/api/storage/__tests__/storage-get.contract.test.ts`.
 *
 * The lists of types and extensions below are written from the contract (what
 * a raster image, audio, video or PDF is called on the wire), not copied from
 * the module, so a type dropped from the module turns a property red.
 *
 * Generators: types are drawn from the inline set or from structured dangerous
 * types (HTML, XHTML, SVG, XML, scripts, near-miss spellings, a comma list, a
 * dangerous type carrying an inline type in a parameter), each with random
 * letter case, a `; param` suffix and surrounding whitespace. Keys follow the
 * shape uploads produce, `<prefix>/<yyyy>/<mm>/<uuid>-<name>`, with names that
 * are safe, hostile (quotes, CR/LF, slashes, header injection) or non-ASCII.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  DOWNLOAD_CSP,
  downloadFileName,
  isInlineType,
  redirectPolicy,
  servedFileHeaders,
} from '../serve-policy'

const RASTER_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/x-icon',
]
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'video/m4v']
const AUDIO_TYPES = ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4']
const PDF_TYPES = ['application/pdf']
const OPENABLE_TYPES = [...RASTER_IMAGE_TYPES, ...VIDEO_TYPES, ...AUDIO_TYPES, ...PDF_TYPES]

const SCRIPTABLE_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'text/javascript',
  'application/javascript',
  'text/plain',
  'application/json',
  'text/css',
  'application/octet-stream',
  'application/zip',
  'image/svg',
  'image/pngx',
  'application/pdfx',
  'image/png+xml',
  'image/png,text/html',
  'image',
  'html',
  '',
]

/** extension -> type the contract says that extension means, case-insensitively. */
const OPENABLE_EXTENSIONS: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  pdf: 'application/pdf',
}

const SCRIPTABLE_EXTENSIONS = [
  'html',
  'htm',
  'xhtml',
  'shtml',
  'svg',
  'svgz',
  'xml',
  'js',
  'mjs',
  'txt',
  'json',
  'css',
  'php',
  'exe',
  'zip',
  'png ',
  'png.',
  '',
]

const SAFE_HEADER_FILENAME = /^[A-Za-z0-9._-]+$/

function withRandomCase(text: string): fc.Arbitrary<string> {
  return fc
    .array(fc.boolean(), { minLength: text.length, maxLength: text.length })
    .map((upperFlags) =>
      text
        .split('')
        .map((character, index) =>
          upperFlags[index] ? character.toUpperCase() : character.toLowerCase()
        )
        .join('')
    )
}

const whitespace = fc
  .array(fc.constantFrom(' ', '\t'), { maxLength: 3 })
  .map((characters) => characters.join(''))

const parameterSuffix = fc.constantFrom(
  '',
  '; charset=utf-8',
  ';charset=UTF-8',
  '; codecs="avc1.42E01E"',
  ' ; boundary=x'
)

function decorated(types: string[], extraSuffixes: fc.Arbitrary<string>) {
  return fc
    .tuple(fc.constantFrom(...types), extraSuffixes)
    .chain(([type, suffix]) =>
      fc.tuple(whitespace, withRandomCase(type), fc.constant(suffix), whitespace)
    )
    .map(([before, type, suffix, after]) => `${before}${type}${suffix}${after}`)
}

const openableContentType = decorated(OPENABLE_TYPES, parameterSuffix)

const scriptableContentType = decorated(
  SCRIPTABLE_TYPES,
  fc.oneof(parameterSuffix, fc.constantFrom('; type=image/png', '; x=application/pdf'))
)

const uuid = fc.uuid().map((value) => value.toLowerCase())
const keyPrefix = fc.constantFrom('chat-files', 'post-media', 'portal-images', 'exports')

const safeName = fc.stringMatching(/^[A-Za-z0-9._-]{1,30}$/)

const hostileName = fc.oneof(
  fc.string({ unit: 'grapheme' }),
  fc.string({ unit: 'binary' }),
  fc.constantFrom(
    '"; filename="evil.html',
    'a\r\nSet-Cookie: x=1.txt',
    'x"y.txt',
    '../../etc/passwd',
    'ünï.pdf',
    '報告.pdf',
    '‮gpj.exe',
    '..',
    '.',
    ''
  )
)

function uploadKey(prefix: string, id: string, name: string): string {
  return `${prefix}/2026/09/${id}-${name}`
}

describe('which stored types open in the browser (F23)', () => {
  it('(F23) a raster image, audio, video or PDF type opens inline, whatever its case, parameters or padding', () => {
    fc.assert(
      fc.property(
        openableContentType,
        keyPrefix,
        uuid,
        safeName,
        (contentType, prefix, id, name) => {
          const headers = servedFileHeaders(uploadKey(prefix, id, name), contentType)

          expect(isInlineType(contentType)).toBe(true)
          expect(headers).toEqual({})
        }
      )
    )
  })

  it('(F23) every other type, HTML and SVG included, is a download under a sandbox policy', () => {
    fc.assert(
      fc.property(
        scriptableContentType,
        keyPrefix,
        uuid,
        safeName,
        (contentType, prefix, id, name) => {
          const headers = servedFileHeaders(uploadKey(prefix, id, name), contentType)

          expect(isInlineType(contentType)).toBe(false)
          expect(headers['Content-Disposition']).toMatch(/^attachment; /)
          expect(headers['Content-Security-Policy']).toBe(DOWNLOAD_CSP)
          expect(headers['Content-Security-Policy']).toContain('sandbox')
        }
      )
    )
  })

  it('(F23) any text at all is either opened inline with no restriction or served as a download with the sandbox policy', () => {
    fc.assert(
      fc.property(fc.string(), (contentType) => {
        const headers = servedFileHeaders('chat-files/a.bin', contentType)

        const isDownload = 'Content-Disposition' in headers
        const hasSandbox = headers['Content-Security-Policy'] === DOWNLOAD_CSP
        // Unguarded: a response is never half a download.
        expect(isDownload).toBe(hasSandbox)
        expect(isDownload).toBe(!isInlineType(contentType))
      })
    )
  })

  it('(F23) which type a file claims decides, not what its key looks like', () => {
    fc.assert(
      fc.property(
        scriptableContentType,
        fc.constantFrom(...Object.keys(OPENABLE_EXTENSIONS)),
        (contentType, extension) => {
          const headers = servedFileHeaders(`chat-files/picture.${extension}`, contentType)

          expect(headers['Content-Disposition']).toMatch(/^attachment; /)
        }
      )
    )
  })
})

describe('the name a download is saved under (F24)', () => {
  it('(F24) a download carries the name the file was sent with, never the storage id', () => {
    fc.assert(
      fc.property(keyPrefix, uuid, safeName, scriptableContentType, (prefix, id, name, type) => {
        const headers = servedFileHeaders(uploadKey(prefix, id, name), type)

        expect(headers['Content-Disposition']).toBe(`attachment; filename="${name}"`)
        expect(headers['Content-Disposition']!.toLowerCase()).not.toContain(id)
      })
    )
  })

  it('(F24) a file without a storage id in its key is saved under its last path segment', () => {
    fc.assert(
      fc.property(keyPrefix, safeName, (prefix, name) => {
        expect(downloadFileName(`${prefix}/${name}`)).toBe(name)
      })
    )
  })

  it('(F24) whatever the name holds, the header is one well-formed line without the id', () => {
    fc.assert(
      fc.property(keyPrefix, uuid, hostileName, scriptableContentType, (prefix, id, name, type) => {
        const headers = servedFileHeaders(uploadKey(prefix, id, name), type)

        const disposition = headers['Content-Disposition']!
        const match = /^attachment; filename="([^"]*)"$/.exec(disposition)
        expect(match, disposition).not.toBeNull()
        expect(match![1]).toMatch(SAFE_HEADER_FILENAME)
        expect(disposition).not.toMatch(/[\r\n\\]/)
        expect(disposition.toLowerCase()).not.toContain(id)
      })
    )
  })

  it('(F24) the extension a person sees in the saved name is the one the file was sent with', () => {
    const stem = fc.string({ unit: 'grapheme' }).map((text) => text.replaceAll('/', '_'))
    const extension = fc.stringMatching(/^[a-z0-9]{1,5}$/)

    fc.assert(
      fc.property(keyPrefix, uuid, stem, extension, (prefix, id, fileStem, ext) => {
        const saved = downloadFileName(uploadKey(prefix, id, `${fileStem}.${ext}`))

        expect(saved.endsWith(`.${ext}`)).toBe(true)
      })
    )
  })
})

describe('the redirect decides from the extension, by the same rule (F25)', () => {
  const openableExtension = fc
    .constantFrom(...Object.keys(OPENABLE_EXTENSIONS))
    .chain((extension) => fc.tuple(fc.constant(extension), withRandomCase(extension)))

  it('(F25) an extension of an openable type forces that type, which F23 opens inline', () => {
    fc.assert(
      fc.property(
        keyPrefix,
        uuid,
        safeName,
        openableExtension,
        (prefix, id, stem, [extension, spelled]) => {
          const policy = redirectPolicy(uploadKey(prefix, id, `${stem}.${spelled}`))

          expect(policy).toEqual({ inlineType: OPENABLE_EXTENSIONS[extension] })
          expect(isInlineType(OPENABLE_EXTENSIONS[extension]!)).toBe(true)
        }
      )
    )
  })

  it('(F25) any other extension is a download under the file name, whatever the stem', () => {
    const scriptableExtension = fc
      .constantFrom(...SCRIPTABLE_EXTENSIONS.filter((extension) => extension !== ''))
      .chain((extension) => withRandomCase(extension))

    fc.assert(
      fc.property(keyPrefix, uuid, safeName, scriptableExtension, (prefix, id, stem, extension) => {
        const key = uploadKey(prefix, id, `${stem}.${extension}`)

        const policy = redirectPolicy(key)

        expect(policy).toEqual({ downloadName: downloadFileName(key) })
        expect(policy).toHaveProperty(
          'downloadName',
          `${stem}.${extension}`.replace(/[^A-Za-z0-9._-]/g, '_')
        )
      })
    )
  })

  it('(F25) a key without an extension is a download', () => {
    fc.assert(
      fc.property(
        keyPrefix,
        uuid,
        fc.stringMatching(/^[A-Za-z0-9_-]{1,20}$/),
        (prefix, id, stem) => {
          expect(redirectPolicy(uploadKey(prefix, id, stem))).toEqual({ downloadName: stem })
        }
      )
    )
  })

  it('(F25) a page that is named like a picture still arrives as that picture, never as HTML', () => {
    fc.assert(
      fc.property(keyPrefix, uuid, safeName, openableExtension, (prefix, id, stem, [, spelled]) => {
        const policy = redirectPolicy(uploadKey(prefix, id, `${stem}.html.${spelled}`))

        expect('inlineType' in policy).toBe(true)
        if ('inlineType' in policy) expect(policy.inlineType).not.toMatch(/html|svg|xml/)
      })
    )
  })

  it('(F25) every key gets exactly one of: a forced inline type, or a safe download name', () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        const policy = redirectPolicy(`chat-files/${name.replaceAll('/', '_')}`)

        const forcesType = 'inlineType' in policy
        const namesDownload = 'downloadName' in policy
        expect(forcesType !== namesDownload).toBe(true)
        if ('inlineType' in policy) expect(isInlineType(policy.inlineType)).toBe(true)
        if ('downloadName' in policy) expect(policy.downloadName).toMatch(SAFE_HEADER_FILENAME)
      })
    )
  })
})

describe('embedded images and videos keep rendering (F26)', () => {
  it('(F26) every image and video type served for embedding is an inline response with no attachment', () => {
    fc.assert(
      fc.property(
        decorated([...RASTER_IMAGE_TYPES, ...VIDEO_TYPES], parameterSuffix),
        keyPrefix,
        uuid,
        safeName,
        (contentType, prefix, id, name) => {
          const headers = servedFileHeaders(uploadKey(prefix, id, name), contentType)

          expect(headers).not.toHaveProperty('Content-Disposition')
          expect(headers).not.toHaveProperty('Content-Security-Policy')
        }
      )
    )
  })

  it('(F26) a file of every image and video type, by its usual extension, is redirected inline as that type', () => {
    const usualExtensionOfType: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/avif': 'avif',
      'image/x-icon': 'ico',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
      // Some browsers label an .m4v file video/m4v; it is served as video/x-m4v.
      'video/x-m4v': 'm4v',
    }

    for (const [mediaType, extension] of Object.entries(usualExtensionOfType)) {
      const policy = redirectPolicy(`post-media/2026/09/clip.${extension}`)

      expect(policy, mediaType).toEqual({ inlineType: mediaType })
    }
  })
})
