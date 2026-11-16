import { act, useId, useState, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { FLIGHT_REGISTRY_GLOBAL } from '@next-federation/protocol'
import type {
  IslandBridge,
  MountIslandOptions,
} from '@next-federation/protocol'
import { isNFError } from '@next-federation/sdk'
import { createIslandBootstrap } from '../src/bootstrap/create-bootstrap.tsx'
import type { FlightScope } from '../src/bootstrap/flight-scope.ts'
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const KEY = 'https://remote.test/base/'

function Counter() {
  const [n, setN] = useState(0)
  return <button onClick={() => setN(n + 1)}>{`count ${n}`}</button>
}
function Boom(): ReactNode {
  throw new Error('boom')
}

// The fake flight client: the stream text selects what the "payload" renders.
const elements: Record<string, () => ReactNode> = {
  counter: () => <Counter />,
  boom: () => <Boom />,
}
const decoder = new TextDecoder()
const loadClientReference = rs.fn(async (id: string) => ({ id }))
// 'slow' payloads resolve only when the test calls `releaseSlow()`, like a
// cold remote whose client references are still loading.
let releaseSlow: () => void = () => {}
const createFromReadableStream = rs.fn(
  async (stream: ReadableStream<Uint8Array>) => {
    const text = decoder.decode((await stream.getReader().read()).value)
    if (text === 'slow') {
      await new Promise<void>((r) => (releaseSlow = r))
      return <Counter />
    }
    return elements[text]!()
  }
) as never

const bridge: IslandBridge = {
  navigate() {},
  prefetch() {},
  basePath: '',
  locale: '',
}

function setup(over: { mode?: 'development' | 'production' } = {}) {
  return createIslandBootstrap({
    scopeKey: KEY,
    remote: 'a',
    buildId: 'b1',
    mode: over.mode ?? 'production',
    loadClientReference,
    createFromReadableStream,
  })
}

function options(over: Partial<MountIslandOptions> = {}): MountIslandOptions {
  return {
    envelope: { remote: 'a', buildId: 'b1', mode: 'production' },
    rscPayload: 'counter',
    identifierPrefix: 'p1-',
    bridge,
    ...over,
  }
}

let container: HTMLElement
let errorSpy: ReturnType<typeof rs.spyOn>
const errorLog = () => errorSpy.mock.calls.flat().join(' ')
beforeEach(() => {
  container = document.createElement('div')
  container.innerHTML = renderToString(<Counter />)
  document.body.appendChild(container)
  errorSpy = rs.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  container.remove()
  rs.restoreAllMocks()
})

async function mount(opts = options(), mod = setup()) {
  let handle!: ReturnType<typeof mod.mountIsland>
  await act(async () => {
    handle = mod.mountIsland(container, opts)
  })
  return handle
}

test('hydrates the container with the given identifierPrefix', async () => {
  const handle = await mount()
  expect(container.querySelector('button')?.textContent).toBe('count 0')
  // Hydration attached handlers to the server-rendered node.
  await act(async () => {
    container.querySelector('button')!.click()
  })
  expect(container.querySelector('button')?.textContent).toBe('count 1')
  await act(async () => handle.destroy())
})

test('the identifierPrefix reaches React (useId output)', async () => {
  let seen = ''
  function Id() {
    const id = useId()
    seen = id
    return <i>{id}</i>
  }
  elements.id = () => <Id />
  // Server HTML rendered with the same prefix, so hydration matches.
  container.innerHTML = renderToString(<Id />, { identifierPrefix: 'zz-' })
  const serverId = container.querySelector('i')!.textContent
  expect(serverId).toContain('zz-')
  const handle = await mount(
    options({ rscPayload: 'id', identifierPrefix: 'zz-' })
  )
  expect(seen).toBe(serverId)
  expect(container.querySelector('i')?.textContent).toBe(serverId)
  expect(errorLog()).not.toMatch(/[Hh]ydration/)
  await act(async () => handle.destroy())
})

test('update keeps client state', async () => {
  const handle = await mount()
  await act(async () => {
    container.querySelector('button')!.click()
  })
  expect(container.querySelector('button')?.textContent).toBe('count 1')
  await act(async () => handle.update({ rscPayload: 'counter' }))
  expect(container.querySelector('button')?.textContent).toBe('count 1')
  await act(async () => handle.destroy())
})

test('destroy empties the root', async () => {
  const handle = await mount()
  await act(async () => handle.destroy())
  expect(container.innerHTML).toBe('')
})

test('an envelope from another build throws NF-010', () => {
  const mod = setup()
  for (const envelope of [
    { remote: 'a', buildId: 'other', mode: 'production' as const },
    { remote: 'z', buildId: 'b1', mode: 'production' as const },
  ]) {
    let error: unknown
    try {
      mod.mountIsland(container, options({ envelope }))
    } catch (e) {
      error = e
    }
    expect(isNFError(error, 'NF-010')).toBe(true)
  }
})

test('a development envelope in a production bootstrap throws NF-006', () => {
  let error: unknown
  try {
    setup().mountIsland(
      container,
      options({ envelope: { remote: 'a', buildId: 'b1', mode: 'development' } })
    )
  } catch (e) {
    error = e
  }
  expect(isNFError(error, 'NF-006')).toBe(true)
})

test('onError receives uncaught errors with kind "uncaught"', async () => {
  const onError = rs.fn()
  const handle = await mount(options({ onError }))
  // React's act() bypasses the error callbacks and rethrows, so render this
  // update outside act and wait for the callback.
  const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  g.IS_REACT_ACT_ENVIRONMENT = false
  try {
    handle.update({ rscPayload: 'boom' })
    for (let i = 0; i < 100 && onError.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10))
    }
  } finally {
    g.IS_REACT_ACT_ENVIRONMENT = true
  }
  expect(onError).toHaveBeenCalledWith(expect.any(Error), 'uncaught')
})

test('calling a server action rejects with NF-019', async () => {
  const handle = await mount()
  const options2 = createFromReadableStream as unknown as {
    mock: {
      calls: [
        unknown,
        { callServer: (id: string, a: unknown[]) => Promise<unknown> },
      ][]
    }
  }
  const callServer = options2.mock.calls.at(-1)![1].callServer
  await expect(callServer('action#id', [])).rejects.toMatchObject({
    code: 'NF-019',
  })
  await act(async () => handle.destroy())
})

test('registers a flight scope once, memoising and stripping $$cache', async () => {
  loadClientReference.mockClear()
  setup()
  setup()
  const scope = (
    globalThis as unknown as Record<string, Record<string, FlightScope>>
  )[FLIGHT_REGISTRY_GLOBAL]![KEY]!
  const first = await scope.require('/src/x.tsx$$cache=1')
  const second = await scope.require('/src/x.tsx$$cache=2')
  expect(first).toBe(second)
  expect(loadClientReference).toHaveBeenCalledTimes(1)
  expect(loadClientReference).toHaveBeenCalledWith('/src/x.tsx')
  await expect(scope.chunkLoad('c')).resolves.toBeUndefined()
})

test('update after destroy is a no-op and destroy is idempotent', async () => {
  const handle = await mount()
  await act(async () => handle.destroy())
  await act(async () => {
    handle.update({ rscPayload: 'counter' })
    handle.destroy()
  })
  expect(container.innerHTML).toBe('')
  expect(String(errorLog())).not.toMatch(/unmounted root/)
})

test('without onError React keeps its default error reporting', async () => {
  // React's default reports through the global error channel.
  const seen = rs.fn()
  const listener = (e: Event) => {
    e.preventDefault()
    seen(e)
  }
  window.addEventListener('error', listener)
  const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  const handle = await mount(options())
  g.IS_REACT_ACT_ENVIRONMENT = false
  try {
    handle.update({ rscPayload: 'boom' })
    for (let i = 0; i < 100 && seen.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10))
    }
  } finally {
    g.IS_REACT_ACT_ENVIRONMENT = true
    window.removeEventListener('error', listener)
  }
  expect(seen).toHaveBeenCalled()
})

describe('hydration signal', () => {
  const settled = (p: Promise<unknown> | undefined) => {
    let done = false
    void p?.then(() => (done = true))
    return async () => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })
      return done
    }
  }

  test('hydrated resolves only after the root has committed', async () => {
    const handle = setup().mountIsland(
      container,
      options({ rscPayload: 'slow' })
    )
    expect(handle.hydrated).toBeInstanceOf(Promise)
    const isDone = settled(handle.hydrated)
    expect(await isDone()).toBe(false)
    await act(async () => releaseSlow())
    expect(await isDone()).toBe(true)
    // Interactive: the click is handled by the hydrated root.
    await act(async () => {
      container.querySelector('button')!.click()
    })
    expect(container.querySelector('button')?.textContent).toBe('count 1')
    await act(async () => handle.destroy())
  })

  test('an update before hydration is held and the newest applied after it', async () => {
    elements.two = () => <p>two</p>
    elements.three = () => <p>three</p>
    const onError = rs.fn()
    const handle = setup().mountIsland(
      container,
      options({ rscPayload: 'slow', onError })
    )
    handle.update({ rscPayload: 'two' })
    handle.update({ rscPayload: 'three' })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    // Still the server HTML: nothing replaced the dehydrated root.
    expect(container.querySelector('button')?.textContent).toBe('count 0')
    await act(async () => releaseSlow())
    await act(async () => {
      await handle.hydrated
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(container.textContent).toBe('three')
    expect(onError).not.toHaveBeenCalled()
    expect(errorLog()).not.toMatch(/early update/)
    await act(async () => handle.destroy())
  })

  test('destroy before hydration reports no recoverable error', async () => {
    // A host that unmounts an island while it is still hydrating (rapid
    // navigation): React reports the unmount as an "early update" to the
    // dehydrated root. The root is gone, so that is not an island error.
    const onError = rs.fn()
    const handle = setup().mountIsland(
      container,
      options({ rscPayload: 'slow', onError })
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    await act(async () => handle.destroy())
    await act(async () => releaseSlow())
    expect(onError).not.toHaveBeenCalled()
    expect(container.innerHTML).toBe('')
  })

  test('a second mountIsland on a container with a live root throws NF-012', async () => {
    const mod = setup()
    const handle = await mount(options(), mod)
    let error: unknown
    try {
      mod.mountIsland(container, options())
    } catch (e) {
      error = e
    }
    expect(isNFError(error, 'NF-012')).toBe(true)
    // Another bootstrap (another remote or build) is refused as well.
    expect(() => setup().mountIsland(container, options())).toThrow(/NF-012/)
    expect(errorLog()).not.toMatch(/already been passed to createRoot/)
    await act(async () => handle.destroy())
    // After destroy the container can be mounted again.
    container.innerHTML = renderToString(<Counter />)
    const again = await mount(options(), mod)
    expect(container.querySelector('button')?.textContent).toBe('count 0')
    await act(async () => again.destroy())
  })
})
