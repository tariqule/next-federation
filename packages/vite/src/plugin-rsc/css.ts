import { isValidElement } from 'react'
import type { ReactNode } from 'react'
import { ISLAND_CSS_EXPORT } from './constants.ts'

const CLIENT_REFERENCE = Symbol.for('react.client.reference')

type Element = { href?: unknown; children?: ReactNode }

async function collect(node: ReactNode, base: string, out: string[]) {
  if (Array.isArray(node)) {
    for (const child of node) await collect(child as ReactNode, base, out)
    return
  }
  if (!isValidElement<Element>(node)) return
  const type = node.type as unknown
  if ((type as { $$typeof?: symbol } | null)?.$$typeof === CLIENT_REFERENCE) {
    return
  }
  if (typeof type === 'function') {
    const rendered = await (
      type as (props: unknown) => ReactNode | Promise<ReactNode>
    )(node.props)
    await collect(rendered, base, out)
    return
  }
  if (typeof node.props.href === 'string') {
    out.push(new URL(node.props.href, base).href)
  }
  await collect(node.props.children, base, out)
}

/**
 * Stylesheet URLs, absolute against `base`, from what plugin-rsc's
 * `loadCss()` returns (server components rendering `<link>` elements). The
 * host renders the links; island HTML never carries them.
 */
export async function collectCssHrefs(
  node: ReactNode,
  base: string
): Promise<string[]> {
  const out: string[] = []
  await collect(node, base, out)
  return [...new Set(out)]
}

/** The CSS URLs of one island module (its appended `__nf_css` export). */
export function islandCssUrls(
  mod: Record<string, unknown>,
  base: string
): Promise<string[]> {
  const load = mod[ISLAND_CSS_EXPORT]
  if (typeof load !== 'function') return Promise.resolve([])
  return collectCssHrefs((load as () => ReactNode)(), base)
}
