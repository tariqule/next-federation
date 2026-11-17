/** `text` without trailing `/`. A scan, not `/\/+$/`: that regex is quadratic on a long run of inner slashes. */
export function trimTrailingSlashes(text: string): string {
  let end = text.length
  while (end > 0 && text.charCodeAt(end - 1) === 0x2f) end--
  return text.slice(0, end)
}
