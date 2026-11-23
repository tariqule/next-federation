// The next/link shim inside a host that registered its router: what the
// host's own Link (Next's `next/link` on a Next.js host) receives.
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, rs } from '@rstest/core'
import { createRouterModule } from '../src/create-router-module.tsx'
import type { RouterModule } from '../src/create-router-module.tsx'
import * as documentRouter from '../src/document-router.tsx'
import Link, { formatHref } from '../src/shims/next-link.tsx'

const h = rs.hoisted(() => ({
  hostLink: rs.fn((props: { href: string; children?: ReactNode }) => props),
  module: null as RouterModule | null,
}))

// `@next-federation/router` is the host's module, as Module Federation gives
// it to a remote build (read when the shim renders).
rs.mock('@next-federation/router', () => ({
  get Link() {
    return h.module!.Link
  },
}))

h.module = createRouterModule({
  Link: (props) => {
    h.hostLink(props)
    return <a data-host-link="" href={props.href} />
  },
  useNavigate: documentRouter.useNavigate,
  usePathname: documentRouter.usePathname,
  useSearchParams: documentRouter.useSearchParams,
})

beforeEach(() => {
  h.hostLink.mockClear()
})

/** The props the host's Link got for `node`. */
function hostProps(node: ReactNode): Record<string, unknown> {
  renderToString(node)
  expect(h.hostLink).toHaveBeenCalledTimes(1)
  return h.hostLink.mock.calls[0]![0] as Record<string, unknown>
}

describe('next/link shim, host router registered', () => {
  it("prefetch unset reaches the host's Link as undefined (Next's default prefetch); true and false pass through", () => {
    const unset = hostProps(<Link href="/a">a</Link>)
    expect(unset.href).toBe('/a')
    expect(unset.prefetch).toBeUndefined()

    h.hostLink.mockClear()
    expect(
      hostProps(
        <Link href="/a" prefetch>
          a
        </Link>
      ).prefetch
    ).toBe(true)
    h.hostLink.mockClear()
    expect(
      hostProps(
        <Link href="/a" prefetch={false}>
          a
        </Link>
      ).prefetch
    ).toBe(false)
  })

  it("prefetch 'auto' or null (newer Next values) reach the host's Link as undefined", () => {
    expect(
      hostProps(<Link href="/a" prefetch="auto" />).prefetch
    ).toBeUndefined()
    h.hostLink.mockClear()
    expect(
      hostProps(<Link href="/a" prefetch={null} />).prefetch
    ).toBeUndefined()
  })
})

describe('formatHref', () => {
  it('formats array and number query values like Next.js (a=1&a=2, numbers as strings)', () => {
    expect(
      formatHref({
        pathname: '/p',
        query: { a: ['1', '2'], n: 3, s: 'x y' },
      })
    ).toBe('/p?a=1&a=2&n=3&s=x+y')
    expect(
      formatHref({
        pathname: '/p',
        query: { id: 7, tags: [1, 2] },
        hash: 'h',
      })
    ).toBe('/p?id=7&tags=1&tags=2#h')
    // Empty, undefined and null values: as Next.js writes them.
    expect(
      formatHref({
        pathname: '/p',
        query: { e: '', u: undefined, z: null, b: true },
      })
    ).toBe('/p?e=&u=&z=&b=true')
  })
})
