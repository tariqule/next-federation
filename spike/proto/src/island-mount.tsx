'use client';
// Host-side island mount (design §6 "Island mount: lifecycle rules").
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { IslandEnvelope } from './protocol';

type Bridge = {
  navigate(href: string): void;
  prefetch(href: string): void;
  basePath: string;
  locale?: string;
};
type IslandHandle = {
  update(envelope: IslandEnvelope): void;
  destroy(): void;
  buildId: string;
};
type Bootstrap = {
  mountIsland(
    el: HTMLElement,
    opts: {
      envelope: IslandEnvelope;
      mode: 'hydrate';
      bridge?: Partial<Bridge>;
      callServer?: (id: string, args: unknown[]) => Promise<unknown>;
      getToken?: () => Promise<string | null>;
      onError?: (e: unknown, kind: string) => void;
    },
  ): IslandHandle;
};

type Entry = {
  el: HTMLElement;
  handle: IslandHandle | null;
  /** Newest envelope seen; applied via update() once booted. */
  latest: IslandEnvelope;
  /** Envelope matching the frozen server HTML; hydration must use this one. */
  original: IslandEnvelope;
  buildId: string;
  bootstrap: string;
};

// Rule 3: the island root is keyed to the container DOM node, not to the effect.
const entries = new WeakMap<HTMLElement, Entry>();
const live = new Set<Entry>();

const loadBootstrap = (url: string): Promise<Bootstrap> =>
  import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ url
  );

// Rule 4: tear down roots whose container left the document.
function destroyEntry(e: Entry) {
  e.handle?.destroy();
  e.handle = null;
  live.delete(e);
  if (entries.get(e.el) === e) entries.delete(e.el);
  publishCount();
}
function sweep() {
  for (const e of live) if (!e.el.isConnected) destroyEntry(e);
}
// Debug counter of hydrated roots currently alive.
function publishCount() {
  let n = 0;
  for (const e of live) if (e.handle) n++;
  (globalThis as any).__nf_liveRoots = n;
}

export type IslandMountProps = {
  envelope: IslandEnvelope;
  bridge?: Partial<Bridge>;
  callServer?: (id: string, args: unknown[]) => Promise<unknown>;
  /** Host token endpoint for this island's remote (design §9a); returns a token as text or {token}. */
  tokenEndpoint?: string;
  onIslandError?: (error: unknown, kind: string) => void;
  fallback?: ReactNode;
};

// Tokens are fetched lazily from the host's endpoint and reused until shortly before expiry.
const tokenCache = new Map<string, { token: string; exp: number }>();
async function fetchToken(endpoint: string): Promise<string | null> {
  const hit = tokenCache.get(endpoint);
  if (hit && hit.exp - 30 > Date.now() / 1000) return hit.token;
  const res = await fetch(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
  });
  if (!res.ok) return null;
  const text = await res.text();
  const token = text.startsWith('{')
    ? (JSON.parse(text) as { token: string }).token
    : text;
  const exp = JSON.parse(
    atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')),
  ).exp as number;
  tokenCache.set(endpoint, { token, exp });
  return token;
}

const defaultOnError = (error: unknown, kind: string) =>
  console.error(`[next-federation] island ${kind} error:`, error);

export function IslandMount({
  envelope,
  bridge,
  callServer,
  tokenEndpoint,
  onIslandError = defaultOnError,
}: IslandMountProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Rule 6: the HTML is written only on first render, then frozen.
  const [html] = useState(envelope.html);
  const opts = useRef({ bridge, callServer, tokenEndpoint, onIslandError });
  opts.current = { bridge, callServer, tokenEndpoint, onIslandError };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    sweep();
    let entry = entries.get(el);
    const start = (target: Entry) => {
      loadBootstrap(target.bootstrap).then(
        (m) => {
          if (!el.isConnected || entries.get(el) !== target || target.handle)
            return;
          target.handle = m.mountIsland(el, {
            // Hydrate with the envelope the HTML was rendered from, then catch up.
            envelope: target.original,
            mode: 'hydrate',
            bridge: opts.current.bridge,
            callServer: opts.current.callServer,
            getToken: async () =>
              opts.current.tokenEndpoint
                ? fetchToken(opts.current.tokenEndpoint)
                : null,
            onError: (e, kind) => opts.current.onIslandError?.(e, kind),
          });
          if (target.latest !== target.original)
            target.handle.update(target.latest);
          el.dataset.nfState = 'live';
          publishCount();
        },
        (e) => opts.current.onIslandError?.(e, 'bootstrap'),
      );
    };
    const create = (): Entry => {
      const e: Entry = {
        el,
        handle: null,
        latest: envelope,
        original: envelope,
        buildId: envelope.buildId,
        bootstrap: envelope.bootstrap,
      };
      entries.set(el, e);
      live.add(e);
      return e;
    };
    if (!entry) {
      // First mount of this container (or a swapped-in container, rule 5).
      start(create());
    } else if (
      entry.buildId !== envelope.buildId ||
      entry.bootstrap !== envelope.bootstrap
    ) {
      // Remote redeployed: the only case where island HTML is replaced.
      destroyEntry(entry);
      el.dataset.nfState = 'booting';
      el.innerHTML = envelope.html;
      start(create());
    } else if (entry.latest !== envelope) {
      // Rule 6: later updates apply only the new RSC payload.
      entry.latest = envelope;
      entry.handle?.update(envelope);
    }
    // Rules 3/4: cleanup never unmounts synchronously (StrictMode / Activity safe). It only
    // schedules a check: a node still connected (re-run effect, hidden Activity) is kept.
    return () => {
      setTimeout(() => {
        if (el.isConnected) return;
        const e = entries.get(el);
        if (e) destroyEntry(e);
      }, 0);
    };
  }, [envelope]);

  return (
    <div
      ref={ref}
      data-nf-root=""
      data-nf-build={envelope.buildId}
      data-nf-state="booting"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
