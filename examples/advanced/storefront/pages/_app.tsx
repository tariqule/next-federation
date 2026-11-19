import type { AppProps } from 'next/app'
import { ActivityToasts, InspectToggle } from 'example-inspect/client'
import 'example-inspect/inspect.css'
import { Providers } from '../lib/Providers'
import '../app/styles.css'

// The Pages Router routes of the storefront (here: /store/admin). They have
// no App Router layout, so they render their own header (pages/admin.tsx).
export default function App({ Component, pageProps }: AppProps) {
  return (
    <Providers>
      <Component {...pageProps} />
      <ActivityToasts />
      <InspectToggle />
    </Providers>
  )
}
