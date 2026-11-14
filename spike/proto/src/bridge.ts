// Both Next routers add basePath in push(), so the bridge strips it first (design §6, maintainer review I7).
export function stripBasePath(href: string, basePath: string): string {
  if (!basePath) return href;
  if (href === basePath) return '/';
  const next = href[basePath.length];
  if (
    href.startsWith(basePath) &&
    (next === '/' || next === '?' || next === '#')
  ) {
    const rest = href.slice(basePath.length);
    return rest.startsWith('/') ? rest : `/${rest}`;
  }
  return href;
}

// Pages Router push() adds basePath and the locale itself (via the `locale` option), so the
// bridge hands it a bare path plus the locale found in the island's href (design §6, I7).
export function toPagesRouterHref(
  href: string,
  basePath: string,
  locales: readonly string[],
): { href: string; locale: string | undefined } {
  const path = stripBasePath(href, basePath);
  const match = /^\/([^/?#]+)(?=$|[/?#])/.exec(path);
  if (match && locales.includes(match[1]!)) {
    const rest = path.slice(match[0].length);
    return {
      href: rest.startsWith('/') ? rest : `/${rest}`,
      locale: match[1],
    };
  }
  return { href: path, locale: undefined };
}
