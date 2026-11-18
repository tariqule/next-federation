import { Head, Html, Main, NextScript } from 'next/document'
import { ARRIVALS_SCRIPT } from 'example-inspect'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Demo only: lets "How is this page built?" tell the first HTML from later parts. */}
        <script dangerouslySetInnerHTML={{ __html: ARRIVALS_SCRIPT }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
