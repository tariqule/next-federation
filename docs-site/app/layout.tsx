import './global.css'
import type { Metadata } from 'next'
import { RootProvider } from 'fumadocs-ui/provider/next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: {
    default: 'next-federation',
    template: '%s | next-federation',
  },
  description:
    'Runtime composition of React UI from separately deployed apps, for Next.js 16.',
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
