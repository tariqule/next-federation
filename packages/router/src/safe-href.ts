// The one check every navigation goes through (the document router's
// `navigate`, every router module's `useNavigate`, the host Link's click):
// only an href that stays on this page's origin, over http(s), is followed.
// A `javascript:` URL, another origin (`https://x`, `//x`, `\\x`, `/\t/x`)
// or anything that does not parse is dropped, with a development warning.
import { warnOnceInDevelopment } from './dev-warning.ts'

// Browsers remove tabs and newlines anywhere in a URL, and strip leading C0
// controls and spaces.
const TABS_AND_NEWLINES = /[\t\n\r]/g
const LEADING_JUNK = /^[\u0000- ]+/

/**
 * The href as the browser reads it, when it resolves (against the page) to
 * an http(s) URL of the page's own origin; otherwise null. Always null where
 * there is no page (server).
 */
export function sameOriginHref(href: unknown): string | null {
  if (typeof href !== 'string' || typeof location === 'undefined') return null
  const clean = href.replace(TABS_AND_NEWLINES, '').replace(LEADING_JUNK, '')
  let url: URL
  try {
    url = new URL(clean, location.href)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url.origin === location.origin ? clean : null
}

const SCHEME_OR_AUTHORITY = /^(?:[a-z][a-z0-9+.-]*:|[\\/]{2})/i

/**
 * The href as the browser reads it when it is a path, query or fragment on
 * the current origin (no scheme, no `//` or `\\` authority); otherwise null.
 * Needs no page, so the server and the browser agree (hydration).
 */
export function localHref(href: string): string | null {
  const clean = href.replace(TABS_AND_NEWLINES, '').replace(LEADING_JUNK, '')
  return SCHEME_OR_AUTHORITY.test(clean) ? null : clean
}

const SCRIPT_SCHEME = /^(?:javascript|vbscript|data):/i

/**
 * The href a plain `<a>` may carry: the href itself, or undefined when the
 * browser would read it as a `javascript:`, `vbscript:` or `data:` URL
 * (React 18 renders those as they are).
 */
export function anchorHref(href: unknown): string | undefined {
  if (typeof href !== 'string') return undefined
  const clean = href.replace(TABS_AND_NEWLINES, '').replace(LEADING_JUNK, '')
  return SCRIPT_SCHEME.test(clean) ? undefined : href
}

/** `sameOriginHref`, warning (development only) when the href is dropped. */
export function checkedHref(href: unknown): string | null {
  const safe = sameOriginHref(href)
  if (safe === null) {
    warnOnceInDevelopment(
      `navigate:${String(href)}`,
      `navigation to ${JSON.stringify(String(href))} was dropped: a remote component navigates only within this page's origin (use a plain <a href> for another site).`
    )
  }
  return safe
}
