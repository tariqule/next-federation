import type { ReactNode } from 'react'
import { ARRIVALS_SCRIPT } from 'example-inspect'
import { ActivityToasts, InspectToggle } from 'example-inspect/client'
import 'example-inspect/inspect.css'
import { LOCALES } from '../../lib/federation.config'
import { SiteHeader } from '../../lib/HeaderParts'
import { Providers } from '../../lib/Providers'
import '../styles.css'

export const metadata = {
  title: 'Trailhead: next-federation commerce platform',
}

// Both locales are prerendered; the layout is part of every static shell.
export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }))
}

export default async function RootLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  return (
    <html lang={lang}>
      <head>
        {/* Demo only: lets "How is this page built?" tell the first HTML from streamed parts. */}
        <script dangerouslySetInnerHTML={{ __html: ARRIVALS_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <SiteHeader lang={lang} />
          <p className="role">
            This app is a <b>host</b> (Next.js 16, App Router with{' '}
            <code>cacheComponents</code>, plus Pages Router routes). It embeds
            islands from the CDP, PDP, SERP and Account remotes and components
            from the Header remote (Rspack).{' '}
            <a href={lang === 'fr' ? '/store/en' : '/store/fr'}>
              {lang === 'fr' ? 'English' : 'Français'}
            </a>
          </p>
          {children}
          <ActivityToasts />
          <InspectToggle />
        </Providers>
      </body>
    </html>
  )
}
