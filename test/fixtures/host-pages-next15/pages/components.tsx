import type { GetServerSideProps } from 'next'
import { getComponentDescriptor } from '@next-federation/next/pages/server'
import { componentsFederation } from '../lib/components'
import { ComponentsPage } from '../lib/components-page'
import type { ComponentsProps } from '../lib/components-page'

// A remote component from the signed descriptor, on this host's next/link.
export const getServerSideProps: GetServerSideProps<
  ComponentsProps
> = async () => ({
  props: {
    descriptor: await getComponentDescriptor(
      componentsFederation,
      'components'
    ),
  },
})

export default ComponentsPage
