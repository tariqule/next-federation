/**
 * Demo only: an inline script for the host's <head> that records how each
 * element of the page arrived, so the "How is this page built?" badges can
 * say what was in the first HTML and what streamed in later. It reads the
 * DOM only; it never changes it.
 *
 * Method: a MutationObserver registered before <body> is parsed sees every
 * element the HTML parser inserts.
 * - Inserted while the document is still parsing, in place: part of the
 *   first HTML ('html'), for a static page this is the prerendered shell.
 * - A hidden <div id="S:n">: a Suspense boundary that React streamed later
 *   in the same response. Its placeholder <template id="B:n"> sits where the
 *   content goes, so the script notes the embed that holds the placeholder
 *   ('streamedInto'), when the segment arrives and again when React removes
 *   the placeholder to swap the content in (sometimes as new nodes, and
 *   sometimes after the observer has run): the embed, not the element, is
 *   what is remembered.
 * - Inserted after DOMContentLoaded: rendered in the browser ('browser'),
 *   for example after a client-side navigation.
 * A <template data-nf-browser-only> in the server HTML is the library's mark
 * for a remote component the server left to the browser; the script notes
 * the embed it belongs to.
 *
 * The records live under one Symbol.for key on window (demo code; the
 * library itself creates no such global).
 */
export const ARRIVALS_SCRIPT = `(() => {
  const KEY = Symbol.for('example-inspect.arrivals')
  if (window[KEY]) return
  const seen = new WeakMap()
  const times = new WeakMap()
  const browserOnly = new WeakSet()
  const streamedInto = new WeakSet()
  const segments = new Set()
  let parsed = false
  document.addEventListener('DOMContentLoaded', () => { parsed = true })
  const segment = (el) => el && el.closest ? el.closest('div[hidden][id^="S:"]') : null
  const embedFor = (el) => {
    for (let i = 0; el && i < 20; i++) {
      const wrapper = el.closest('.embedded')
      if (wrapper) return wrapper
      const s = segment(el)
      if (!s) return null
      el = document.getElementById('B:' + s.id.slice(2))
    }
    return null
  }
  const visit = (el, how) => {
    if (seen.has(el)) return
    seen.set(el, how)
    times.set(el, Math.round(performance.now()))
    if (el.matches('template[data-nf-browser-only]')) {
      const wrapper = embedFor(el)
      if (wrapper) browserOnly.add(wrapper)
    }
  }
  new MutationObserver((records) => {
    for (const record of records) {
      const parent = record.target.nodeType === 1 ? record.target : record.target.parentElement
      for (const node of record.removedNodes) {
        if (node.nodeType === 1 && /^B:/.test(node.id) && segments.has(node.id.slice(2))) {
          const wrapper = embedFor(parent)
          if (wrapper) streamedInto.add(wrapper)
        }
      }
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue
        const how = parsed
          ? 'browser'
          : segment(parent) || (node.hidden && /^S:/.test(node.id))
            ? 'streamed'
            : 'html'
        if (node.hidden && /^S:/.test(node.id) && !parsed) {
          segments.add(node.id.slice(2))
          const wrapper = embedFor(document.getElementById('B:' + node.id.slice(2)))
          if (wrapper) streamedInto.add(wrapper)
        }
        visit(node, how)
        node.querySelectorAll('*').forEach((child) => visit(child, how))
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true })
  window[KEY] = { seen, times, browserOnly, streamedInto }
})()`
