import { notFound } from 'next/navigation'
import { MODE_A_REMOTES } from '../../../lib/components'
import { ModeAPage } from '../../../lib/ModeAPage'

// /mode-a/tampered, /unsigned, /redeploy, /down: per-request descriptor.
export default function Page({
  params,
}: {
  params: Promise<{ remote: string }>
}) {
  const remote = params.then(({ remote }) => {
    if (!(MODE_A_REMOTES as readonly string[]).includes(remote)) notFound()
    return remote
  })
  return <ModeAPage remote={remote} dynamic />
}
