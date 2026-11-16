import { getComponentDescriptor } from '@next-federation/next/server'
import { CartButton } from './CartButton'
import { federation } from './federation'

// The descriptor names the remote build to render (cached for
// `components.revalidate` seconds). Passing it as a prop makes the browser
// load that same build, so a redeploy in between cannot break hydration.
export async function RemoteCartButton({ sku }: { sku: string }) {
  const descriptor = await getComponentDescriptor(federation, 'cart')
  return <CartButton descriptor={descriptor} sku={sku} />
}
