import type { GetServerSideProps } from 'next'
import { getComponentDescriptor } from '@next-federation/next/pages/server'
import { componentsFederation } from '../lib/components'
import { ComponentsPage } from '../lib/components-page'
import type { ComponentsProps } from '../lib/components-page'

// Nothing listens on the `down` remote: the component renders its fallback.
export const getServerSideProps: GetServerSideProps<
  ComponentsProps
> = async () => ({
  props: {
    descriptor: await getComponentDescriptor(componentsFederation, 'down'),
  },
})

export default ComponentsPage
