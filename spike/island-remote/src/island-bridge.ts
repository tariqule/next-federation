'use client';
import { createContext, useContext } from 'react';

// Host navigation bridge, provided per island root by the bootstrap (design §6 navigation bridge).
export type Bridge = {
  navigate(href: string): void;
  prefetch(href: string): void;
  basePath: string;
  locale?: string;
};
const noop: Bridge = {
  navigate: (href) => location.assign(href),
  prefetch: () => {},
  basePath: '',
};
export const BridgeContext = createContext<Bridge>(noop);
export const useBridge = () => useContext(BridgeContext);
