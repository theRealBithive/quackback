// @vitest-environment happy-dom
/**
 * The SDK launcher on a host page (`packages/widget/src/core/launcher.ts`).
 *
 * It lives here rather than in `packages/widget/__tests__` because the root
 * vitest run excludes `packages/widget/**` (it has its own config), while
 * apps/web ships the launcher: `widget-preview.tsx` mounts it and
 * `/api/widget/sdk.js` serves it. The preview covers the *contained* launcher;
 * this suite covers the free-standing one a visitor's browser gets, which is
 * the half that touches session storage.
 *
 * ## P — Widget install pairing (upstream 98b18e3ee)
 * - P6 The launcher's greeting is dismissed for the session when storage allows
 *   it and only for the page load when it does not; placement moves button and
 *   bubble to the requested edge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { createLauncher } from '../../../../../../../packages/widget/src/core/launcher'

const GREETING_DISMISS_KEY = 'quackback:launcher-greeting-dismissed'
const HOST_EDGE = '24px'
const CONTAINED_EDGE = '0px'

type Side = 'left' | 'right'

function makeLauncher(placement: Side = 'right', root?: HTMLElement) {
  return createLauncher({ placement, root, onClick: () => {} })
}

/** The bubble is the first element the launcher appends to its mount point. */
function bubbleIn(mount: HTMLElement): HTMLElement {
  return mount.querySelector('div') as HTMLElement
}

function dismissButtonOf(bubble: HTMLElement): HTMLElement {
  return bubble.lastElementChild as HTMLElement
}

/**
 * The session-storage states a browser actually puts a host page in: it works,
 * it refuses the write (Safari private mode / quota), or it refuses everything
 * (a sandboxed frame, blocked site data). A storage whose reads throw while its
 * writes succeed is not one of them, and is deliberately not modelled here — see
 * the note on the property below.
 */
type StorageMode = 'working' | 'writeRefused' | 'blocked'

/**
 * Replaces session storage with one in the chosen state — happy-dom's own
 * `sessionStorage` cannot be spied through `Storage.prototype`. The returned map
 * is the oracle: it says what was really stored, independent of the facade the
 * launcher talks to.
 */
function installSessionStorage(mode: StorageMode): Map<string, string> {
  const stored = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem(key: string) {
      if (mode === 'blocked') throw new Error('storage blocked')
      return stored.get(key) ?? null
    },
    setItem(key: string, value: string) {
      if (mode !== 'working') throw new Error('private mode')
      stored.set(key, value)
    },
    removeItem(key: string) {
      stored.delete(key)
    },
    clear() {
      stored.clear()
    },
  })
  return stored
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('launcher greeting dismissal on a host page', () => {
  it('remembers the dismissal for the browser session when storage accepts it (P6)', () => {
    const stored = installSessionStorage('working')
    const launcher = makeLauncher()
    launcher.setGreeting('Need a hand?')
    const bubble = bubbleIn(document.body)
    expect(bubble.style.display).toBe('flex')

    dismissButtonOf(bubble).click()

    expect(bubble.style.display).toBe('none')
    expect(stored.get(GREETING_DISMISS_KEY)).toBe('1')

    // A second page of the same session gets a launcher that stays quiet.
    document.body.innerHTML = ''
    makeLauncher().setGreeting('Need a hand?')
    expect(bubbleIn(document.body).style.display).toBe('none')
  })

  it('dismisses for this page load only when storage refuses the write (P6)', () => {
    const stored = installSessionStorage('writeRefused')

    const launcher = makeLauncher()
    launcher.setGreeting('Need a hand?')
    const bubble = bubbleIn(document.body)

    dismissButtonOf(bubble).click()

    expect(bubble.style.display).toBe('none')
    expect(stored.has(GREETING_DISMISS_KEY)).toBe(false)

    // Nothing was remembered, so the next launcher of this page load invites again.
    document.body.innerHTML = ''
    makeLauncher().setGreeting('Need a hand?')
    expect(bubbleIn(document.body).style.display).toBe('flex')
  })

  it('shows the greeting when storage cannot even be read (P6)', () => {
    installSessionStorage('blocked')

    makeLauncher().setGreeting('Need a hand?')

    expect(bubbleIn(document.body).style.display).toBe('flex')
  })

  /**
   * The unguarded law across every storage state: a dismiss hides the bubble,
   * and storage remembers it exactly when it accepted the write.
   *
   * The generator models the three states a browser produces (see StorageMode).
   * An earlier version also crossed them with a storage whose *reads* throw
   * while its writes succeed; that combination leaves the bubble visible,
   * because the launcher reads a failed read as "not dismissed" while the write
   * had gone through. No browser produces that pairing, and P6 speaks of a
   * storage that allows the dismissal or does not, so the state was dropped as
   * outside the contract rather than the law weakened to accommodate it.
   */
  it('hides the greeting on dismiss whatever session storage does (P6)', () => {
    const storageMode = fc.constantFrom<StorageMode>('working', 'writeRefused', 'blocked')
    const greetings = fc.array(
      fc
        .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '), { minLength: 1, maxLength: 24 })
        .map((chars) => `Hi ${chars.join('')}`),
      { minLength: 1, maxLength: 4 }
    )

    fc.assert(
      fc.property(storageMode, greetings, (mode, texts) => {
        document.body.innerHTML = ''
        const stored = installSessionStorage(mode)

        const launcher = makeLauncher()
        const bubble = bubbleIn(document.body)

        for (const text of texts) {
          launcher.setGreeting(text)
          dismissButtonOf(bubble).click()
          // A dismiss always wins, whatever storage is doing underneath.
          expect(bubble.style.display).toBe('none')
        }

        // Storage remembers the dismissal exactly when it accepted the write.
        expect(stored.has(GREETING_DISMISS_KEY)).toBe(mode === 'working')
      }),
      { numRuns: 120 }
    )
  })
})

describe('launcher placement', () => {
  it('moves the button and the greeting bubble to the requested edge (P6)', () => {
    const launcher = makeLauncher('right')
    launcher.setGreeting('Need a hand?')
    const bubble = bubbleIn(document.body)

    launcher.setPlacement('left')

    expect(launcher.el.style.left).toBe(HOST_EDGE)
    expect(launcher.el.style.right).toBe('')
    expect(bubble.style.left).toBe(HOST_EDGE)
    expect(bubble.style.right).toBe('')

    launcher.setPlacement('right')

    expect(launcher.el.style.right).toBe(HOST_EDGE)
    expect(launcher.el.style.left).toBe('')
    expect(bubble.style.right).toBe(HOST_EDGE)
    expect(bubble.style.left).toBe('')
  })

  it('keeps button and bubble on one edge through any sequence of moves (P6)', () => {
    const moves = fc.array(fc.constantFrom<Side>('left', 'right'), {
      minLength: 1,
      maxLength: 8,
    })

    fc.assert(
      fc.property(
        moves,
        fc.boolean(),
        fc.constantFrom<Side>('left', 'right'),
        (sides, inRoot, start) => {
          document.body.innerHTML = ''
          let root: HTMLElement | undefined
          if (inRoot) {
            root = document.createElement('div')
            document.body.appendChild(root)
          }
          const mount = root ?? document.body
          const launcher = makeLauncher(start, root)
          launcher.setGreeting('Need a hand?')
          const bubble = bubbleIn(mount)
          // A contained launcher sits on its host element's edge, not the viewport's.
          const edge = inRoot ? CONTAINED_EDGE : HOST_EDGE

          for (const side of sides) launcher.setPlacement(side)

          const requested = sides[sides.length - 1]
          const opposite: Side = requested === 'left' ? 'right' : 'left'
          expect(launcher.el.style[requested]).toBe(edge)
          expect(launcher.el.style[opposite]).toBe('')
          // The bubble belongs to the button: same edge, same clearing.
          expect(bubble.style[requested]).toBe(launcher.el.style[requested])
          expect(bubble.style[opposite]).toBe(launcher.el.style[opposite])
        }
      ),
      { numRuns: 200 }
    )
  })
})
