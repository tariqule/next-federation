import { readFileSync } from 'node:fs'
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { FederationErrorBoundary } from '../src/error-boundary.tsx'
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // React logs caught render errors; keep test output clean.
  rs.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  rs.restoreAllMocks()
})

function render(node: ReactNode): void {
  act(() => root.render(node))
}

function Boom({ error }: { error: unknown }): ReactNode {
  throw error
}

describe('FederationErrorBoundary', () => {
  test('renders children when nothing throws', () => {
    render(
      <FederationErrorBoundary fallback={<p>fallback</p>}>
        <p>ok</p>
      </FederationErrorBoundary>
    )
    expect(container.textContent).toBe('ok')
  })

  test('renders the fallback and calls onError once when a child throws', () => {
    const onError = rs.fn()
    const error = new Error('boom')
    render(
      <FederationErrorBoundary fallback={<p>fallback</p>} onError={onError}>
        <Boom error={error} />
      </FederationErrorBoundary>
    )
    expect(container.textContent).toBe('fallback')
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(error)
  })

  test('a function fallback receives the error', () => {
    const error = new Error('boom')
    render(
      <FederationErrorBoundary fallback={(e) => <p>{(e as Error).message}!</p>}>
        <Boom error={error} />
      </FederationErrorBoundary>
    )
    expect(container.textContent).toBe('boom!')
  })

  test('a thrown undefined still shows the fallback (hasError)', () => {
    const received: unknown[] = []
    render(
      <FederationErrorBoundary
        fallback={(e) => {
          received.push(e)
          return <p>fallback</p>
        }}
      >
        <Boom error={undefined} />
      </FederationErrorBoundary>
    )
    expect(container.textContent).toBe('fallback')
    expect(received[0]).toBeUndefined()
  })

  test('a throwing onError does not break the fallback', () => {
    render(
      <FederationErrorBoundary
        fallback={<p>fallback</p>}
        onError={() => {
          throw new Error('observer broke')
        }}
      >
        <Boom error={new Error('boom')} />
      </FederationErrorBoundary>
    )
    expect(container.textContent).toBe('fallback')
  })

  test('changing resetKey renders children again', () => {
    let shouldThrow = true
    function Maybe(): ReactNode {
      if (shouldThrow) throw new Error('boom')
      return <p>recovered</p>
    }
    const tree = (key: number) => (
      <FederationErrorBoundary fallback={<p>fallback</p>} resetKey={key}>
        <Maybe />
      </FederationErrorBoundary>
    )
    render(tree(1))
    expect(container.textContent).toBe('fallback')
    shouldThrow = false
    render(tree(1))
    expect(container.textContent).toBe('fallback')
    render(tree(2))
    expect(container.textContent).toBe('recovered')
  })

  test('source keeps the "use client" directive', () => {
    expect(
      readFileSync('packages/react/src/error-boundary.tsx', 'utf8')
    ).toMatch(/^['"]use client['"]/)
  })
})
