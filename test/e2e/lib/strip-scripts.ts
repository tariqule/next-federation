// Test-only: removes the scripts from a server-rendered page so a spec can
// assert on the rendered markup alone (Next's embedded RSC rows and
// __NEXT_DATA__ also carry fallbacks and props). Not a sanitizer.
import { parse } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
type Template = DefaultTreeAdapterMap['template']

/** Source ranges of every `<script>` element (HTML, SVG, MathML), in document order. */
function scriptRanges(node: Node, out: Array<[number, number]>): void {
  if ('tagName' in node && node.tagName === 'script') {
    const loc = (node as Element).sourceCodeLocation
    if (loc) out.push([loc.startOffset, loc.endOffset])
    return
  }
  if ('content' in node) scriptRanges((node as Template).content, out)
  if ('childNodes' in node)
    for (const child of node.childNodes) scriptRanges(child, out)
}

/**
 * `html` without its `<script>` elements, as the HTML parser delimits them.
 * Every other byte is kept as it was (nothing is re-serialized).
 */
export function stripScripts(html: string): string {
  const ranges: Array<[number, number]> = []
  scriptRanges(parse(html, { sourceCodeLocationInfo: true }), ranges)
  let out = ''
  let at = 0
  for (const [start, end] of ranges) {
    out += html.slice(at, start)
    at = end
  }
  return out + html.slice(at)
}

/** The rendered markup: no scripts and no React text separators (`<!-- -->`). */
export function markup(html: string): string {
  return stripScripts(html).replaceAll('<!-- -->', '')
}
