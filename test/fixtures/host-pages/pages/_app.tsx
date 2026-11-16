import type { AppProps } from 'next/app'
import Link from 'next/link'
import { provideHostReact } from '@next-federation/react/share'

// `/shared` only: islands on this host's exact React version run on it
// (provideHostReact). Module scope in the browser, before the first island
// bootstraps; every other page keeps the islands' own shared React.
if (
  typeof window !== 'undefined' &&
  /\/shared\/?$/.test(window.location.pathname)
) {
  ;(window as { __hostProvidedReact?: boolean }).__hostProvidedReact =
    provideHostReact()
}

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <nav>
        <Link href="/">home</Link> | <Link href="/static">static</Link> |{' '}
        <Link href="/nav/one">nav</Link> | <Link href="/orders">orders</Link>
      </nav>
      <Component {...pageProps} />
    </>
  )
}
