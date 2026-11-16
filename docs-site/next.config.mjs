import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: '/docs',
        destination: '/docs/getting-started/app-router',
        permanent: false,
      },
      // The guide was "Client components" before; old links keep working.
      {
        source: '/docs/client-components/:path*',
        destination: '/docs/remote-components/:path*',
        permanent: true,
      },
    ]
  },
}

export default withMDX(config)
