import { cookies } from 'next/headers'
import { Embedded } from 'example-inspect'
import { PagePanel } from 'example-inspect/client'
import { RemoteIsland } from '../../../lib/federation'
import { GUIDES, SOURCE } from '../../../lib/guides'
import { sessionFrom } from '../../../lib/session'

const TRAIL = ['Storefront', 'App Router page /[lang]/account']

// The account page is per user. Its two private islands are `blocking`: they
// are in the first HTML, in place, with no loading state. That reads the
// session outside <Suspense>, which a cacheComponents app accepts only with
// this export (without it `next build` fails, so the change is never silent).
// The route has no static shell: `next build` lists it as ƒ.
export const instant = false

export default async function Account({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  const store = await cookies()
  const session = sessionFrom((name) => store.get(name)?.value)
  return (
    <main>
      <PagePanel
        mode="dynamic"
        router="App Router"
        why="export const instant = false and two blocking private islands: every request renders the page, and the islands are in the first HTML."
        file={`${SOURCE}/app/[lang]/account/page.tsx`}
        guide={GUIDES.blocking}
      />
      <h1>{lang === 'fr' ? 'Mon compte' : 'My account'}</h1>
      {/* DEMO ONLY: see app/api/session/route.ts. */}
      <form action="/store/api/session" method="post" className="sign-in">
        <input type="hidden" name="next" value={`/${lang}/account`} />
        {session ? (
          <>
            Signed in as <b>{session.user}</b> ({session.role}){' '}
            <button name="user" value="">
              Sign out
            </button>
          </>
        ) : (
          <>
            <input
              name="user"
              placeholder="any name"
              aria-label="Name"
              required
            />{' '}
            <label>
              <input type="radio" name="role" value="customer" defaultChecked />{' '}
              customer
            </label>{' '}
            <label>
              <input type="radio" name="role" value="admin" /> admin
            </label>{' '}
            <button>Sign in</button>
          </>
        )}
      </form>
      <Embedded
        kind="island"
        remote="account"
        name="Profile"
        router="App Router"
        cache="blocking"
        isPrivate
        trail={TRAIL}
      >
        <RemoteIsland
          remote="account"
          island="Profile"
          locale={lang}
          private
          blocking
          errorFallback={<p>Sign in to see your profile.</p>}
        />
      </Embedded>
      <Embedded
        kind="island"
        remote="account"
        name="Orders"
        router="App Router"
        cache="blocking"
        isPrivate
        trail={TRAIL}
      >
        <RemoteIsland
          remote="account"
          island="Orders"
          locale={lang}
          private
          blocking
          errorFallback={<p>Sign in to see your orders.</p>}
        />
      </Embedded>
    </main>
  )
}
