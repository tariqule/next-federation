import './global.css'
import type { Metadata } from 'next'
import { RootProvider } from 'fumadocs-ui/provider/next'
import type { ReactNode } from 'react'
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, TAGLINE } from '@/lib/seo'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME}: ${TAGLINE}`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    'Next.js micro-frontends',
    'module federation Next.js',
    'Next.js 16',
    'App Router',
    'React Server Components',
    'runtime UI composition',
    'islands',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'en_US',
    title: `${SITE_NAME}: ${TAGLINE}`,
    description: SITE_DESCRIPTION,
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME}: ${TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>
          {children}
          <footer className="border-t border-fd-border px-4 py-6 text-center text-sm text-fd-muted-foreground">
            Not affiliated with or endorsed by Vercel. Next.js is a trademark of
            Vercel, Inc.
          </footer>
        </RootProvider>
      </body>
    </html>
  )
}
