// Ambient types for the entry modules. They are compiled by this package but
// run inside the remote's Vite build, where these ids and globals exist.

declare module 'virtual:next-federation/config' {
  const config: import('../options.ts').ResolvedOptions
  export default config
}

declare module 'virtual:next-federation/islands' {
  const islands: Record<
    string,
    { load: () => Promise<Record<string, unknown>>; private: boolean }
  >
  export default islands
}

declare module 'virtual:vite-rsc/client-references' {
  const references: Record<string, () => Promise<unknown>>
  export default references
}

declare module 'react-server-dom-webpack/client.browser' {
  export function createFromReadableStream<T>(
    stream: ReadableStream<Uint8Array>,
    options?: { callServer?: (id: string, args: unknown[]) => Promise<unknown> }
  ): Promise<T>
}

interface ImportMeta {
  readonly env: {
    readonly DEV: boolean
    readonly __vite_rsc_build__: boolean
  }
  readonly hot?: { accept(): void }
  readonly viteRsc: {
    loadCss(importer?: string): import('react').ReactNode
    loadModule<T>(environmentName: string, entryName?: string): Promise<T>
  }
}
