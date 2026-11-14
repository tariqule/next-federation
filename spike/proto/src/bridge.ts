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
