import { createElement } from 'react'

// A tiny shared UI library. The header remote shares it with Module
// Federation as a *bundled* (non-singleton) module that requires ^2.0.0:
// a host that passes a satisfying copy has it used, and any other host gets
// the copy the remote bundled (the fallback copy). It is stateless on
// purpose: a module whose identity matters (a React context) must not have
// a fallback copy, because two copies mean two contexts.
export const version = '2.1.0'

// Demo probe: which copy of this module is running? A host that passes its
// own copy to remote components calls claimCopy('host') on it at startup.
// The copy a remote bundled is a separate module instance that nobody
// claimed, so it reports 'bundled'. (A real design system has no need for
// this; it is here so the demo can show which copy rendered.)
let owner = 'bundled'
export function claimCopy(name) {
  owner = name
}
export function copyOwner() {
  return owner
}

export function Button({ tone = 'primary', ...props }) {
  return createElement('button', {
    ...props,
    'data-ds': `Button ${version}`,
    'data-ds-copy': owner,
    className: `ds-button ds-button-${tone}`,
    style: {
      font: 'inherit',
      padding: '6px 12px',
      borderRadius: 8,
      border: '1px solid',
      cursor: 'pointer',
      background: tone === 'primary' ? '#1f6f50' : 'transparent',
      color: tone === 'primary' ? '#fff' : 'inherit',
      borderColor: tone === 'primary' ? '#1f6f50' : 'currentColor',
    },
  })
}

export function Pill({ children }) {
  return createElement(
    'span',
    {
      'data-ds': `Pill ${version}`,
      'data-ds-copy': owner,
      style: {
        display: 'inline-block',
        minWidth: '1.5em',
        padding: '0 6px',
        borderRadius: 999,
        background: '#1f6f50',
        color: '#fff',
        fontSize: 12,
        textAlign: 'center',
      },
    },
    children
  )
}
