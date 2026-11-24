// Hrefs that must never reach a host router's Link, and a browser's reading
// of an href attribute (link-guard, shims-next and shims-react-router specs).
export const UNSAFE_LINKS = [
  'java\tscript:alert(document.domain)',
  'java\rscript:alert(1)',
  'java\nscript:alert(1)',
  'javascript:alert(1)',
  '\u0001javascript:alert(1)',
  ' \u0000 javascript:alert(1)',
  'vbscript:msgbox(1)',
  'VBScript:msgbox(1)',
  'data:text/html,<script>alert(1)</script>',
  'da\tta:text/html,x',
  '//evil.example',
  '/\t/evil.example',
  '/\n/evil.example',
  '\\\\evil.example',
  '/\\evil.example',
  '\u0001//evil.example',
  'https://evil.example/',
]

/** A browser's reading of an href attribute: a script scheme or not. */
export function isScriptHref(href: string | null): boolean {
  if (href === null) return false
  const clean = href.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+/, '')
  return /^(?:javascript|vbscript|data):/i.test(clean)
}
