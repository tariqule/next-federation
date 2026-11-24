# NF-040: Remote component threw while rendering

## Why This Error Occurred

A remote component threw while it rendered. Only that component is affected: the host keeps running and the page still answers `200`. The usual causes are a browser-only API read during render, a bug, or unexpected props.

## Possible Ways to Fix It

- Fix the error in the remote and deploy a new build. Hosts pick it up within the descriptor's `revalidate`.
- Keep browser-only code in effects:

  ```tsx
  export function Theme() {
    const [theme, setTheme] = useState('light')
    useEffect(() => setTheme(localStorage.getItem('theme') ?? 'light'), [])
    return <span>{theme}</span>
  }
  ```

- Make components the exposed one renders safe to render on the server, or read the descriptor with `{ dynamic: true }` on that page.

## Useful Links

- [Remote components: runtime behaviour](../guides/remote-components.md#runtime-behaviour)
