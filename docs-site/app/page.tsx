import Link from 'next/link'
import { HomeLayout } from 'fumadocs-ui/layouts/home'
import { baseOptions } from '@/lib/layout.shared'
import { REPO_URL, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/seo'

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareSourceCode',
  name: SITE_NAME,
  description: SITE_DESCRIPTION,
  url: SITE_URL,
  codeRepository: REPO_URL,
  programmingLanguage: 'TypeScript',
  license: 'https://opensource.org/licenses/MIT',
}

// Every app of the live demo, its role and what to try (docs/live-demo.md).
const DEMO_URL = '/docs/live-demo'

const links = [
  { href: '/docs/getting-started/app-router', label: 'App Router host' },
  { href: '/docs/getting-started/pages-router', label: 'Pages Router host' },
  { href: '/docs/getting-started/spa', label: 'Client-side React (SPA) host' },
  {
    href: '/docs/guides/writing-an-island-remote',
    label: 'Writing an island remote',
  },
  { href: '/docs/remote-components/overview', label: 'Remote components' },
  { href: '/docs/architecture', label: 'Architecture' },
  { href: '/docs/errors/unknown-island', label: 'Error codes' },
  { href: '/docs/protocol/v1', label: 'Island protocol v1' },
  { href: '/docs/api/core', label: 'Package API' },
]

export default function HomePage() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-16">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
          }}
        />
        <h1 className="text-4xl font-bold tracking-tight">next-federation</h1>
        <p className="text-lg text-fd-muted-foreground">
          Runtime UI federation for Next.js. A remote app, deployed on its own,
          provides UI that your host app renders at runtime. Embed
          server-rendered React Server Component islands, or load client
          components through Module Federation 2.0 into your host&apos;s own
          React tree. It calls only public Next.js APIs, never Next.js
          internals.
        </p>
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Install</h2>
          <pre className="overflow-x-auto rounded-lg border border-fd-border bg-fd-card p-4 text-sm">
            <code>
              pnpm add @next-federation/core @next-federation/next
              @next-federation/react react react-dom
            </code>
          </pre>
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
          <p className="flex gap-4">
            <Link className="underline" href={DEMO_URL}>
              Live demo
            </Link>
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
