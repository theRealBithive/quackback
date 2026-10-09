/**
 * Which avatar addresses an identity provider may hand us.
 *
 * Every viewer's browser fetches a person's avatar, so the address decides
 * which host learns that someone looked at a page. Only an absolute `https`
 * address is taken: plain `http` would be mixed content on our `https` pages
 * and readable on the wire, and anything else (`data:`, `javascript:`, a
 * relative path, an object) is not an image address at all.
 * OWASP A05 Security Misconfiguration; the server never fetches it (A10).
 */

/** The trimmed address when it is an absolute `https` URL, else undefined. */
export function asHttpsAvatarUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:') return undefined
  return trimmed
}
