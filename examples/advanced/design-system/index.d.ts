import type { ButtonHTMLAttributes, ReactNode } from 'react'

export declare const version: string
/** Demo probe: mark this module instance as the host's copy. */
export declare function claimCopy(owner: string): void
/** 'bundled', or the name passed to claimCopy on this instance. */
export declare function copyOwner(): string
export declare function Button(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: 'primary' | 'quiet'
  }
): ReactNode
export declare function Pill(props: { children: ReactNode }): ReactNode
