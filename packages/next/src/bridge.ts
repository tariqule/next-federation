/**
 * Both Next routers add `basePath` in `push()`, so the island bridge strips it
 * from island hrefs first.
 */
export function stripBasePath(href: string, basePath: string): string {
  if (!basePath) return href
  if (href === basePath) return '/'
  const next = href[basePath.length]
  if (
    href.startsWith(basePath) &&
    (next === '/' || next === '?' || next === '#')
  ) {
    const rest = href.slice(basePath.length)
    return rest.startsWith('/') ? rest : `/${rest}`
  }
  return href
}

/**
 * Pages Router `push()` adds `basePath` and the locale itself (through its
 * `locale` option), so the bridge hands it a bare path plus the locale found
 * in the island's href. With i18n, an href without a locale prefix is the
 * default locale's page (as a hard load of that href would be), so it gets
 * `defaultLocale`: `push()` would otherwise keep the current locale.
 */
export function toPagesRouterHref(
  href: string,
  basePath: string,
  locales: readonly string[],
  defaultLocale?: string
): { href: string; locale: string | undefined } {
  const path = stripBasePath(href, basePath)
  const match = /^\/([^/?#]+)(?=$|[/?#])/.exec(path)
  if (match && locales.includes(match[1]!)) {
    const rest = path.slice(match[0].length)
    return {
      href: rest.startsWith('/') ? rest : `/${rest}`,
      locale: match[1],
    }
  }
  return {
    href: path,
    locale: locales.length > 0 ? defaultLocale : undefined,
  }
}
