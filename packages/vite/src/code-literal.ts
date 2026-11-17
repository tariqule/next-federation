const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

/**
 * A JSON value as a JavaScript literal for generated module source. On top of
 * `JSON.stringify`, `<`, `>`, U+2028 and U+2029 are escaped as `\uXXXX`, so
 * the literal stays inert even if a bundler or server ever inlines the module
 * into an HTML `<script>` (no `</script>`, no `<!--`). The values are
 * build-time config (island names, entry paths, package names and versions).
 */
export function codeLiteral(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll(LINE_SEPARATOR, '\\u2028')
    .replaceAll(PARAGRAPH_SEPARATOR, '\\u2029')
}
