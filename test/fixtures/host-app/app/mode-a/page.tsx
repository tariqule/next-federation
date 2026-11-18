import { ModeAPage } from '../../lib/ModeAPage'

// Remote components, descriptor fetched per request.
export default function Page() {
  return <ModeAPage remote="components" dynamic />
}
