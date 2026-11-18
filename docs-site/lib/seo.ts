export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://next-federation-docs.vercel.app'
).replace(/\/$/, '')
export const SITE_NAME = 'next-federation'
export const REPO_URL = 'https://github.com/tariqule/next-federation'
export const TAGLINE = 'Runtime UI federation for Next.js 16'
export const SITE_DESCRIPTION =
  'Next.js micro-frontends with runtime UI composition. Embed server-rendered React Server Component islands, or load remote client components through Module Federation 2.0, from separately deployed apps, in the App Router, Pages Router or a React SPA.'
