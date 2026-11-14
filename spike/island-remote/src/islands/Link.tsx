'use client';
import type { MouseEvent, ReactNode } from 'react';
import { useBridge } from '../island-bridge';

// A real <a href> (works before hydration, new tabs, modifier-clicks); plain clicks go through the
// host bridge so the host router navigates client-side (design §6 navigation bridge).
export function Link({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const bridge = useBridge();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    )
      return;
    e.preventDefault();
    bridge.navigate(href);
  };
  return (
    <a href={href} onClick={onClick} onMouseEnter={() => bridge.prefetch(href)}>
      {children}
    </a>
  );
}
