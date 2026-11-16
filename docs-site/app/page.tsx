import Link from 'next/link'
import { HomeLayout } from 'fumadocs-ui/layouts/home'
import { baseOptions } from '@/lib/layout.shared'

const links = [
  { href: '/docs/getting-started/app-router', label: 'App Router host' },
  { href: '/docs/getting-started/pages-router', label: 'Pages Router host' },
  { href: '/docs/getting-started/spa', label: 'Client-side React (SPA) host' },
  {
    href: '/docs/guides/writing-an-island-remote',
    label: 'Writing an island remote',
  },
  { href: '/docs/client-components/overview', label: 'Client components' },
  { href: '/docs/errors/unknown-island', label: 'Error codes' },
  { href: '/docs/protocol/v1', label: 'Island protocol v1' },
  { href: '/docs/api/core', label: 'Package API' },
]

export default function HomePage() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-16">
        <h1 className="text-4xl font-bold tracking-tight">next-federation</h1>
        <p className="text-lg text-fd-muted-foreground">
          Runtime composition of React UI from separately deployed apps, for
          Next.js 16 (App Router and Pages Router, Turbopack or webpack). Load
          interactive components from a remote app at runtime, or embed
          server-rendered React Server Component islands that run on the
          remote&apos;s own server. It uses public framework APIs only, so Next
          upgrades do not break it, and no build step is required in the host
          app.
        </p>
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Install</h2>
          <pre className="overflow-x-auto rounded-lg border border-fd-border bg-fd-card p-4 text-sm">
            <code>
              pnpm add @next-federation/core @next-federation/next
              @next-federation/react react react-dom
            </code>
          </pre>
          <p className="text-sm text-fd-muted-foreground">
            The packages are not yet published to npm.
          </p>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Start here</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="block rounded-lg border border-fd-border bg-fd-card p-3 transition-colors hover:bg-fd-accent"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <p>
            <a
              className="underline"
              href="https://github.com/tariqule/next-federation"
            >
              Source on GitHub
            </a>
          </p>
        </section>
      </main>
    </HomeLayout>
  )
}
