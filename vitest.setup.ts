import '@testing-library/jest-dom'
import { AsyncLocalStorage } from 'node:async_hooks'

// Base UI ScrollArea calls getAnimations(); happy-dom does not implement it.
if (typeof Element !== 'undefined' && typeof Element.prototype.getAnimations !== 'function') {
  Element.prototype.getAnimations = () => []
}

// happy-dom's <label> forwards every click to its control, including a click
// whose target already is an interactive descendant of the label. Browsers do
// not: the HTML spec skips the label's activation behaviour when the target is
// interactive content. The difference is not cosmetic. Base UI's Switch and
// Checkbox toggle by dispatching a click on a hidden <input> beside the button;
// inside a <label> happy-dom forwards that click back to the button, the button
// dispatches on the input again, and the pair loops until the call stack
// overflows — measured at 200–270 rounds, with the toggle landing or not
// depending on where the stack gave out (12 of 25 renders lost it). Making the
// label behave like a browser here removes that loop for every label-wrapped
// control at once; a click on the label's text still reaches the control.
if (typeof HTMLLabelElement !== 'undefined') {
  const forwardingDispatch = HTMLLabelElement.prototype.dispatchEvent
  const plainDispatch = HTMLElement.prototype.dispatchEvent
  const INTERACTIVE_CONTENT = 'a[href], button, input, select, textarea'
  HTMLLabelElement.prototype.dispatchEvent = function dispatchEventLikeABrowser(event: Event) {
    const target = event.target
    if (event.type !== 'click' || !(target instanceof Element) || target === this) {
      return forwardingDispatch.call(this, event)
    }
    const interactiveTarget = target.closest(INTERACTIVE_CONTENT)
    const targetIsInteractiveDescendant =
      interactiveTarget !== null && interactiveTarget !== this && this.contains(interactiveTarget)
    if (targetIsInteractiveDescendant) return plainDispatch.call(this, event)
    return forwardingDispatch.call(this, event)
  }
}

// Since @tanstack/react-start 1.168, executing a createServerFn runs the global
// request middleware, which reads the "Start context" from an AsyncLocalStorage
// keyed by this well-known global Symbol. Outside the server runtime (i.e. unit
// tests that call a server function directly, as the docs show) that store is
// empty and getStartContext() throws "No Start context found in AsyncLocalStorage".
//
// Seed the framework's own ALS (it guards creation with `if (!exists)`, so it
// reuses this instance) and make getStore() fall back to an empty context when
// none is active. Empty requestMiddleware means the app's global CSRF/logging
// middleware does not run in unit tests; a real server context still wins.
{
  const KEY = Symbol.for('tanstack-start:start-storage-context')
  const g = globalThis as unknown as Record<symbol, unknown>
  if (!g[KEY]) {
    const als = new AsyncLocalStorage<unknown>()
    const getStore = als.getStore.bind(als)
    als.getStore = () => getStore() ?? { startOptions: { requestMiddleware: [] } }
    g[KEY] = als
  }
}
