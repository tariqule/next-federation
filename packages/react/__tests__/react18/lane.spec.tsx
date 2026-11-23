import { Writable } from 'node:stream'
import { act, createContext, Suspense, useContext, version } from 'react'
import * as ReactDOM from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { renderToPipeableStream } from 'react-dom/server'
import type {
  IslandBootstrapModule,
  IslandEnvelope,
} from '@next-federation/protocol'
import { IslandMount } from '../../src/island-mount.tsx'
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// The `dom-react18` project (rstest.config.ts) resolves `react` and
// `react-dom` to React 18.3.1 from `test/react18`, for these specs and for
// the library source they import.

const PLACEHOLDER = 'nfid-1a2b3c4d'

function envelope(over: Partial<IslandEnvelope> = {}): IslandEnvelope {
  return {
    protocolVersion: 1,
    remote: 'shop',
    buildId: 'b1',
    mode: 'development',
    html: `<p id="${PLACEHOLDER}:r0:">cart v1</p>`,
    rscPayload: `0:["${PLACEHOLDER}:r0:","v1"]`,
    css: [],
    bootstrap: 'https://shop.example.com/_nf/b1/bootstrap.js',
    reactVersion: '19.3.1',
    idPlaceholder: PLACEHOLDER,
    ...over,
  }
}

// The bootstrap never resolves: these specs stop at the host-side mount.
const loadBootstrap = (): Promise<IslandBootstrapModule> =>
  new Promise(() => {})

const Host = createContext('none')

function HostName() {
  return <span data-host="">{useContext(Host)}</span>
}

let container: HTMLElement
let root: Root | null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = null
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  container.remove()
})

it('runs on React 18.3.1', () => {
  expect(version).toBe('18.3.1')
  expect(typeof ReactDOM.preinit).toBe('undefined')
})

it('library source resolves the same React', () => {
  const errors = rstest.spyOn(console, 'error').mockImplementation(() => {})
  try {
    act(() => {
      root = createRoot(container)
      root.render(
        <Host.Provider value="react18">
          <HostName />
          <IslandMount envelope={envelope()} loadBootstrap={loadBootstrap} />
        </Host.Provider>
      )
    })
    const messages = errors.mock.calls.map((args) => String(args[0]))
    expect(messages.filter((m) => /invalid hook call/i.test(m))).toEqual([])
  } finally {
    errors.mockRestore()
  }
  expect(container.querySelector('[data-host]')?.textContent).toBe('react18')
  const island = container.querySelector('[data-nf-root]')
  expect(island?.getAttribute('data-nf-state')).toBe('booting')
  expect(island?.textContent).toBe('cart v1')
})

it('S6: server suspension resolves before allReady', async () => {
  // A thenable cached across renders, as a data cache would hand out.
  let value: string | null = null
  const pending = new Promise<void>((resolve) =>
    setTimeout(() => {
      value = 'resolved on the server'
      resolve()
    }, 10)
  )
  function Data() {
    if (value === null) throw pending
    return <p>{value}</p>
  }

  const html = await new Promise<string>((resolve, reject) => {
    let out = ''
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        out += chunk.toString()
        done()
      },
    })
    sink.on('finish', () => resolve(out))
    const stream = renderToPipeableStream(
      <Suspense fallback={<p>loading fallback</p>}>
        <Data />
      </Suspense>,
      {
        onAllReady() {
          stream.pipe(sink)
        },
        onShellError: reject,
        onError: reject,
      }
    )
  })

  expect(html).toContain('resolved on the server')
  expect(html).not.toContain('loading fallback')
})

// S6 gate: React 18 has no `preinit`; a client mount of an envelope with a
// stylesheet must still render (the link goes to <head> by hand).
it('IslandMount client mount does not throw on React 18', () => {
  act(() => {
    root = createRoot(container)
    root.render(
      <IslandMount
        envelope={envelope({ css: ['https://shop.example.com/_nf/b1/a.css'] })}
        loadBootstrap={loadBootstrap}
      />
    )
  })
  expect(container.querySelector('[data-nf-root]')?.textContent).toBe('cart v1')
})
