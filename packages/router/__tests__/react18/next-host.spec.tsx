// The next/link a Next.js host shares (`guardNextLink`), on React 18.3.1:
// React 18 renders a `javascript:` href as it is, so Next's own Link would
// put a script URL in the page for a remote that lists next/link in
// `shared`. The guarded Link never reaches Next's for one.
import { act, createRef, forwardRef, version } from 'react'
import type { ReactNode, Ref } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { guardNextLink } from '../../src/next-host.tsx'
import { UNSAFE_LINKS, isScriptHref } from '../helpers/unsafe-links.ts'

const calls: unknown[] = []
/** Next's Link as far as this matters: an anchor with the href as given. */
const NextLink = (props: {
  href: unknown
  children?: ReactNode
  [prop: string]: unknown
}) => {
  calls.push(props)
  return <a href={props.href as string}>{props.children}</a>
}
const Link = guardNextLink({ default: NextLink }).default

/** The href attribute of the one anchor in `html`, or null. */
function hrefOf(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.querySelector('a')!.getAttribute('href')
}

test('the lane runs React 18.3.1, which renders a javascript: href as it is', () => {
  expect(version).toBe('18.3.1')
  expect(hrefOf(renderToString(<NextLink href="javascript:alert(1)" />))).toBe(
    'javascript:alert(1)'
  )
})

test.each(UNSAFE_LINKS)(
  'href %j: never Next’s Link, never a script href',
  (href) => {
    calls.length = 0
    const rendered = hrefOf(renderToString(<Link href={href}>x</Link>))
    expect(calls).toHaveLength(0)
    expect(isScriptHref(rendered)).toBe(false)
  }
)

test('an internal href is Next’s Link, props as given', () => {
  calls.length = 0
  renderToString(
    <Link href="/in" prefetch={false}>
      x
    </Link>
  )
  expect(calls).toEqual([{ href: '/in', prefetch: false, children: 'x' }])
})

test('React 18: a ref reaches the anchor, through Next’s Link or the plain one', () => {
  ;(
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  const error = rs.spyOn(console, 'error')
  const ForwardingLink = forwardRef(function NextLinkWithRef(
    props: { href: unknown; children?: ReactNode },
    ref: Ref<HTMLAnchorElement>
  ) {
    return (
      <a ref={ref} data-next-link="" href={props.href as string}>
        {props.children}
      </a>
    )
  })
  const Guarded = guardNextLink({ default: ForwardingLink })
    .default as unknown as (props: Record<string, unknown>) => ReactNode
  const internal = createRef<HTMLAnchorElement>()
  const external = createRef<HTMLAnchorElement>()
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  act(() =>
    root.render(
      <>
        <Guarded href="/in" ref={internal}>
          in
        </Guarded>
        <Guarded href="//evil.example" ref={external}>
          out
        </Guarded>
      </>
    )
  )
  expect(internal.current?.dataset.nextLink).toBe('')
  expect(external.current?.getAttribute('href')).toBe('//evil.example')
  expect(external.current?.dataset.nextLink).toBeUndefined()
  expect(error).not.toHaveBeenCalled()
  act(() => root.unmount())
  el.remove()
  error.mockRestore()
})
