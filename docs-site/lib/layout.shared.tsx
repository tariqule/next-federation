import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: 'next-federation' },
    githubUrl: 'https://github.com/tariqule/next-federation',
    links: [{ text: 'Documentation', url: '/docs' }],
  }
}
