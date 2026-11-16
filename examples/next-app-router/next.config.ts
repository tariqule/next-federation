import { withNextFederation } from '@next-federation/next/config'

// Required: adapter entry points fail with NF-017 without the wrapper.
export default withNextFederation({})
