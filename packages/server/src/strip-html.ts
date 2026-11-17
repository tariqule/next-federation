import { parseFragment, serialize } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'
import { isReactFormReplayScript } from './react-form-replay.ts'

/**
 * An element removed by {@link stripIslandHtml}; `attrs` is the raw text after the tag name.
 * `known: 'react-form-replay'` marks React's own form-replay script (an exact copy, no
 * attributes), removed like any other script.
 */
export type StrippedTag = {
  tag: 'script' | 'link' | 'meta' | 'title' | 'base' | 'style'
  attrs: string
  known?: 'react-form-replay'
}

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
type ChildNode = DefaultTreeAdapterMap['childNode']
type TextNode = DefaultTreeAdapterMap['textNode']
type ParentNode = DefaultTreeAdapterMap['parentNode']

const HTML_NS = 'http://www.w3.org/1999/xhtml'

/** The brief's rule: which element (if any) is stripped, by its parsed identity. */
function strippedTag(el: Element): StrippedTag['tag'] | null {
  const name = el.tagName
  if (name === 'script') return 'script' // HTML, SVG and MathML alike
  if (name === 'link' || name === 'meta' || name === 'base') return name
  if (el.namespaceURI !== HTML_NS) return null // svg <title>/<style> stay
  if (name === 'title') return 'title'
  if (
    name === 'style' &&
    el.attrs.some((a) => a.name === 'precedence' || a.name === 'href')
  ) {
    return 'style'
  }
  return null
}

/**
 * The HTML parser drops one newline right after `<pre>`, `<textarea>` and `<listing>`, and the
 * serializer does not restore it, so a re-parse would lose a real leading newline. Re-add it.
 */
function keepLeadingNewline(el: Element): void {
  if (el.namespaceURI !== HTML_NS) return
  if (
    el.tagName !== 'pre' &&
    el.tagName !== 'textarea' &&
    el.tagName !== 'listing'
  )
    return
  const first = el.childNodes[0]
  if (
    first &&
    first.nodeName === '#text' &&
    (first as TextNode).value.startsWith('\n')
  ) {
    ;(first as TextNode).value = '\n' + (first as TextNode).value
  }
}

const isElement = (n: Node): n is Element => 'tagName' in n

/** The text of an HTML `<script>` with one text child (its raw source), else null. */
function htmlScriptText(el: Element): string | null {
  if (el.namespaceURI !== HTML_NS || el.childNodes.length !== 1) return null
  const only = el.childNodes[0]!
  return only.nodeName === '#text' ? (only as TextNode).value : null
}

/**
 * Remove elements React would hoist or run from island SSR HTML: `<script>` (whole element, in
 * HTML, SVG and MathML), `<link>`, `<meta>`, `<base>`, `<title>` outside `<svg>`, and `<style>`
 * that has a `precedence` or `href` attribute.
 *
 * The input is parsed with parse5 (the WHATWG HTML parser), so which elements exist is decided by
 * the real tree-construction rules: case-insensitivity, quoted attributes, comments, CDATA,
 * raw-text and foreign-content handling all match what a browser builds. The result is parse5's
 * serialization of the cleaned tree: text, whitespace, comments (including React's `<!-- -->`,
 * `<!--$-->` markers) and `<template>` contents are preserved, but markup is normalized the way a
 * browser would (for example void tags lose their `/`, and `<br/>` becomes `<br>`).
 *
 * This is cleanup of framework output so the host's React never sees a hoistable. It is NOT a
 * security boundary: hosts only accept envelopes from allowlisted remotes, and this must not be
 * used to sanitize untrusted HTML.
 */
export function stripIslandHtml(html: string): {
  html: string
  removed: StrippedTag[]
} {
  const root = parseFragment(html, { sourceCodeLocationInfo: true })
  const removed: StrippedTag[] = []

  // Iterative pre-order walk; each parent's child list is rebuilt once (no quadratic splicing).
  type Frame = { parent: ParentNode; kids: Node[]; kept: Node[]; i: number }
  const frameFor = (parent: ParentNode): Frame => ({
    parent,
    kids: parent.childNodes,
    kept: [],
    i: 0,
  })
  const stack: Frame[] = [frameFor(root)]
  while (stack.length > 0) {
    const f = stack[stack.length - 1]!
    if (f.i >= f.kids.length) {
      f.parent.childNodes = f.kept as ChildNode[]
      stack.pop()
      continue
    }
    const child = f.kids[f.i++]!
    if (isElement(child)) {
      const tag = strippedTag(child)
      if (tag) {
        const loc = child.sourceCodeLocation?.startTag
        const attrs = loc
          ? html.slice(
              loc.startOffset + 1 + child.nodeName.length,
              loc.endOffset - 1
            )
          : ''
        const known =
          tag === 'script' &&
          isReactFormReplayScript(child.attrs.length, htmlScriptText(child))
        removed.push(
          known ? { tag, attrs, known: 'react-form-replay' } : { tag, attrs }
        )
        continue
      }
    }
    f.kept.push(child)
    if (isElement(child)) keepLeadingNewline(child)
    if ('childNodes' in child) stack.push(frameFor(child))
    const content = (child as { content?: ParentNode }).content
    if (content) stack.push(frameFor(content))
  }
  return { html: serialize(root), removed }
}
