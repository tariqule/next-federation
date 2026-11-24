// Which hrefs reach a host router's Link: only a path, query or fragment on
// this origin as the browser reads it (tabs and newlines removed, leading
// controls stripped). Anything else is a plain anchor, and a script URL
// (`javascript:`, `vbscript:`, `data:`) gets no href at all.
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, rs } from '@rstest/core'
import { Link as DocumentLink, createRouterModule } from '../src/index.ts'
import type { LinkProps } from '../src/index.ts'
import { UNSAFE_LINKS, isScriptHref } from './helpers/unsafe-links.ts'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const roots: Array<{ unmount(): void }> = []
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount())
  document.body.innerHTML = ''
  rs.restoreAllMocks()
})

function mount(node: ReactNode): HTMLElement {
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  roots.push(root)
  act(() => root.render(node))
  return el
}

describe('createRouterModule Link', () => {
  it("an unsafe href never renders the host's Link; the plain anchor never has a script href", () => {
    const rendered: string[] = []
    const mod = createRouterModule({
      Link: (props: LinkProps) => {
        rendered.push(props.href)
        return <a data-impl href={props.href} />
      },
      useNavigate: () => () => {},
      usePathname: () => '/',
      useSearchParams: () => new URLSearchParams(),
    })
    for (const href of UNSAFE_LINKS) {
      const el = mount(
        <mod.Link href={href} className="c">
          x
        </mod.Link>
      )
      const a = el.querySelector('a')!
      expect(a.hasAttribute('data-impl'), href).toBe(false)
      expect(a.className).toBe('c')
      expect(isScriptHref(a.getAttribute('href')), href).toBe(false)
      // Server HTML too.
      expect(
        isScriptHref(
          /href="([^"]*)"/.exec(
            renderToString(<mod.Link href={href}>x</mod.Link>)
          )?.[1] ?? null
        ),
        href
      ).toBe(false)
    }
    expect(rendered).toEqual([])
    // Another site keeps its href (a plain link to it).
    const el = mount(<mod.Link href="https://example.com/">ext</mod.Link>)
    expect(el.querySelector('a')!.getAttribute('href')).toBe(
      'https://example.com/'
    )
    // A local href is the host's Link.
    mount(<mod.Link href="/ok">ok</mod.Link>)
    expect(rendered).toEqual(['/ok'])
  })
})

describe('document router Link', () => {
  it('never renders a script href', () => {
    for (const href of UNSAFE_LINKS) {
      const el = mount(<DocumentLink href={href}>x</DocumentLink>)
      expect(
        isScriptHref(el.querySelector('a')!.getAttribute('href')),
        href
      ).toBe(false)
    }
    const el = mount(<DocumentLink href="/ok">ok</DocumentLink>)
    expect(el.querySelector('a')!.getAttribute('href')).toBe('/ok')
  })
})
