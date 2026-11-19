import './account.css'
import { updateProfile } from '../actions'
import { currentUser } from '../identity'
import { accountOf } from '../store'
import { ProfileForm } from './ProfileForm'

// A private island with a Server Action. Actions reach client components as
// props, from a Server Component (a client module that imports a
// 'use server' file fails the build with NF-034).
export default async function Profile() {
  const user = currentUser()
  if (!user) throw new Error('Profile needs a signed-in user')
  return (
    <section className="acct-panel">
      <h2>Profile</h2>
      <p>
        Signed in as <b>{user.sub}</b>
        {user.isAdmin ? ' (admin)' : ''}
      </p>
      <ProfileForm
        initialName={accountOf(user.sub).displayName}
        action={updateProfile}
      />
      <small className="acct-build">remote build {__BUILD_ID__}</small>
    </section>
  )
}
