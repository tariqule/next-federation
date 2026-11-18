import { ogSize, renderOg } from '@/lib/og'

export const size = ogSize
export const contentType = 'image/png'
export const alt = 'next-federation: runtime UI federation for Next.js 16'

export default function Image() {
  return renderOg(
    'Runtime UI federation for Next.js 16',
    'Micro-frontends for the App Router, with React Server Component islands.'
  )
}
