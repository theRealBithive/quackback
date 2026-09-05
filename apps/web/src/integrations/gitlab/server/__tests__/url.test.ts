/**
 * GitLab instance and issue URL helpers.
 *
 * The guarantees, in domain language, confirmed before these tests were written:
 *
 * V20 Subgroups belong to the project path; a project in `group/subgroup` is
 *     never read as `group`.
 * V21 An address that does not name an issue yields no project. Nothing is ever
 *     guessed — no match is better than the wrong project, because the path
 *     decides which project we write to.
 * V23 A configured instance address is accepted only over TLS. Every call to
 *     that origin carries the token we hold, so an address without TLS would
 *     put the credential on the wire in the clear.
 * V22 The supported instance is GitLab 18.10 or newer, the version from which
 *     issues live under `/-/work_items/`. Older instances are not served, and
 *     that requirement is written where someone reads it before connecting,
 *     rather than showing up later as an empty result.
 *
 * Two further guarantees were drafted and deliberately rejected, recorded here
 * so the gap in the numbering is a decision rather than an oversight:
 *
 * V18 ("an issue stays closable however the instance changes its address form")
 *     promised compatibility with address shapes nobody has seen yet, which is a
 *     promise no test can hold.
 * V19 ("the same project is read whichever address form GitLab uses") would have
 *     kept the pre-18.10 `/-/issues/` spelling readable alongside the new one.
 *     Dropped on purpose: the supported floor is 18.10, and reading a form the
 *     supported versions no longer emit is compatibility apparatus for instances
 *     we do not serve. The cost is named in V22's test — the old spelling now
 *     resolves to nothing, loudly.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { gitlabCatalog } from '@/integrations/gitlab/server/catalog'
import {
  GITLAB_COM_ORIGIN,
  GitLabInstanceUrlError,
  extractGitLabProjectPath,
  gitlabApiBase,
  normalizeGitLabInstanceUrl,
} from '@/integrations/gitlab/server/url'

describe('normalizeGitLabInstanceUrl', () => {
  it('defaults to gitlab.com when the URL is omitted', () => {
    expect(normalizeGitLabInstanceUrl(undefined)).toBe(GITLAB_COM_ORIGIN)
    expect(normalizeGitLabInstanceUrl(null)).toBe(GITLAB_COM_ORIGIN)
    expect(normalizeGitLabInstanceUrl('')).toBe(GITLAB_COM_ORIGIN)
    expect(normalizeGitLabInstanceUrl('   ')).toBe(GITLAB_COM_ORIGIN)
  })

  it('reduces a custom HTTPS instance to its origin', () => {
    expect(normalizeGitLabInstanceUrl('https://gitlab.example.com')).toBe(
      'https://gitlab.example.com'
    )
    expect(normalizeGitLabInstanceUrl('https://gitlab.example.com/')).toBe(
      'https://gitlab.example.com'
    )
    expect(normalizeGitLabInstanceUrl('https://gitlab.example.com/foo')).toBe(
      'https://gitlab.example.com'
    )
    expect(normalizeGitLabInstanceUrl('https://gitlab.example.com:8443')).toBe(
      'https://gitlab.example.com:8443'
    )
  })

  it('rejects every scheme but https, and says which rule was broken (V23)', () => {
    // The message is the whole diagnosis an operator gets in the settings form,
    // so it is asserted rather than left to the error type. The name goes with
    // it: it is what a log line shows when the message is already truncated.
    expect(() => normalizeGitLabInstanceUrl('javascript:alert(1)')).toThrow(GitLabInstanceUrlError)
    expect(() => normalizeGitLabInstanceUrl('file:///etc/passwd')).toThrow(/https URL/)
    // Plain HTTP is refused with the rest, not tolerated as a lesser evil: the
    // Bearer token goes to this origin on every call.
    expect(() => normalizeGitLabInstanceUrl('http://gitlab.example.com')).toThrow(/https URL/)
    expect(() => normalizeGitLabInstanceUrl('http://localhost:8080')).toThrow(/https URL/)
    try {
      normalizeGitLabInstanceUrl('javascript:alert(1)')
      expect.unreachable('a javascript: URL must not be accepted')
    } catch (error) {
      expect((error as Error).name).toBe('GitLabInstanceUrlError')
    }
  })

  it('rejects URLs that embed credentials, either half of them', () => {
    // Half a credential is still a credential leaving the settings form, and
    // `user@host` alone is the form a copied browser URL takes.
    expect(() => normalizeGitLabInstanceUrl('https://user:pass@gitlab.example.com')).toThrow(
      /must not include credentials/
    )
    expect(() => normalizeGitLabInstanceUrl('https://user@gitlab.example.com')).toThrow(
      /must not include credentials/
    )
    expect(() => normalizeGitLabInstanceUrl('https://:pass@gitlab.example.com')).toThrow(
      /must not include credentials/
    )
  })

  it('rejects unparseable strings, and says so', () => {
    expect(() => normalizeGitLabInstanceUrl('not a url')).toThrow(/must be a valid URL/)
  })
})

describe('gitlabApiBase', () => {
  it('appends /api/v4 to gitlab.com by default', () => {
    expect(gitlabApiBase()).toBe('https://gitlab.com/api/v4')
  })

  it('appends /api/v4 to a custom instance origin', () => {
    expect(gitlabApiBase('https://gitlab.example.com/')).toBe('https://gitlab.example.com/api/v4')
  })
})

describe('extractGitLabProjectPath', () => {
  it('reads the project from a gitlab.com work item URL (V20)', () => {
    expect(extractGitLabProjectPath('https://gitlab.com/my-org/my-project/-/work_items/7')).toBe(
      'my-org/my-project'
    )
  })

  it('keeps every subgroup in the path (V20)', () => {
    expect(
      extractGitLabProjectPath('https://gitlab.example.com/group/sub/project/-/work_items/42')
    ).toBe('group/sub/project')
  })

  it('reads the same project whatever the host and the issue number are (V20)', () => {
    // A non-interference property: the two parts of the URL that carry no
    // project information must not be able to change the answer. Stronger than
    // a handful of examples, and it is what a greedy or under-anchored pattern
    // fails on — a host containing a slash-like escape, an iid of any length.
    const segment = fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,20}$/)
    fc.assert(
      fc.property(
        fc.array(segment, { minLength: 2, maxLength: 4 }),
        fc.domain(),
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.constantFrom('http', 'https'),
        // Everything GitLab appends after the issue number: a trailing slash, a
        // comment anchor, a query, a child route. None of it names a project, so
        // none of it may change the answer.
        fc.constantFrom('', '/', '?foo=1', '#note_12', '/designs'),
        (segments, host, iid, scheme, suffix) => {
          const path = segments.join('/')
          const read = extractGitLabProjectPath(
            `${scheme}://${host}/${path}/-/work_items/${iid}${suffix}`
          )
          expect(read).toBe(path)
        }
      )
    )
  })

  it('yields nothing for an address that names no issue (V21)', () => {
    expect(extractGitLabProjectPath(null)).toBeNull()
    expect(extractGitLabProjectPath(undefined)).toBeNull()
    expect(extractGitLabProjectPath('')).toBeNull()
    expect(extractGitLabProjectPath('https://gitlab.com/my-org/my-project')).toBeNull()
    expect(
      extractGitLabProjectPath('https://gitlab.com/my-org/my-project/-/merge_requests/7')
    ).toBeNull()
    // The project path itself is what decides where a close is sent, so a
    // truncated address must not answer with the group it happens to start with.
    expect(extractGitLabProjectPath('https://gitlab.com/-/work_items/7')).toBeNull()
    // The work item *list* of a project names no issue either. It is one
    // character away from an address that does, which is why it is pinned.
    expect(extractGitLabProjectPath('https://gitlab.com/my-org/my-project/-/work_items')).toBeNull()
    expect(
      extractGitLabProjectPath('https://gitlab.com/my-org/my-project/-/work_items/')
    ).toBeNull()
    expect(
      extractGitLabProjectPath('https://gitlab.com/my-org/my-project/-/work_items/new')
    ).toBeNull()
  })

  it('yields nothing for the pre-18.10 spelling, rather than half-supporting it (V22)', () => {
    // Deliberate, and the visible cost of the 18.10 floor: a link stored before
    // the instance was upgraded carries this form. It now resolves to nothing,
    // which fails the close loudly instead of writing to a guessed project.
    expect(extractGitLabProjectPath('https://gitlab.com/my-org/my-project/-/issues/7')).toBeNull()
    expect(extractGitLabProjectPath('https://gitlab.com/acme/widgets/issues/142')).toBeNull()
  })

  it('states the version it needs where an operator reads it first (V22)', () => {
    // A requirement that lives only in a source comment is one an operator meets
    // by finding out it is not met. This is the copy shown before connecting.
    expect(gitlabCatalog.description).toContain('18.10')
  })
})
