'use client'

import { Component } from 'react'
import type { ReactNode } from 'react'
import { logger } from '@next-federation/sdk'

export type FederationErrorBoundaryProps = {
  fallback: ReactNode | ((error: unknown) => ReactNode)
  onError?: (error: unknown) => void
  /** The boundary resets (renders children again) when this value changes. */
  resetKey?: unknown
  children: ReactNode
}

type State = {
  hasError: boolean
  error: unknown
  resetKey: unknown
}

/**
 * Catches render errors from an island so a failing island never crashes the
 * host page. `hasError` is tracked separately from `error` because a thrown
 * `undefined` or `null` is a valid error value.
 */
export class FederationErrorBoundary extends Component<
  FederationErrorBoundaryProps,
  State
> {
  override state: State = {
    hasError: false,
    error: undefined,
    resetKey: this.props.resetKey,
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { hasError: true, error }
  }

  static getDerivedStateFromProps(
    props: FederationErrorBoundaryProps,
    state: State
  ): Partial<State> | null {
    if (Object.is(props.resetKey, state.resetKey)) return null
    return { hasError: false, error: undefined, resetKey: props.resetKey }
  }

  override componentDidCatch(error: unknown): void {
    const { onError } = this.props
    if (!onError) return
    try {
      onError(error)
    } catch (observerError) {
      // A broken observer must not break the fallback.
      logger.debug('FederationErrorBoundary onError threw', observerError)
    }
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children
    const { fallback } = this.props
    return typeof fallback === 'function'
      ? fallback(this.state.error)
      : fallback
  }
}
