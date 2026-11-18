import { ImageResponse } from 'next/og'
import { SITE_NAME, TAGLINE } from '@/lib/seo'

export const ogSize = { width: 1200, height: 630 }

// Text only, with next/og's bundled default font: no network at build time.
export function renderOg(title: string, subtitle?: string) {
  const long = title.length > 40
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#000',
        color: '#fff',
        padding: 72,
      }}
    >
      <div style={{ fontSize: 40, fontWeight: 600 }}>{SITE_NAME}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div
          style={{
            fontSize: long ? 64 : 84,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: -2,
            maxWidth: 1056,
          }}
        >
          {title}
        </div>
        {subtitle ? (
          <div style={{ fontSize: 32, color: '#a1a1a1', maxWidth: 1056 }}>
            {subtitle}
          </div>
        ) : null}
      </div>
      <div style={{ fontSize: 28, color: '#a1a1a1' }}>{TAGLINE}</div>
    </div>,
    ogSize
  )
}
