// Per-remote island bootstrap: the island's OWN React + flight client, scoped to this remote's origin.
import clientReferences from 'virtual:vite-rsc/client-references';
import { startTransition, use, type ReactNode } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import {
  createFromFetch,
  createFromReadableStream,
  encodeReply,
} from 'react-server-dom-webpack/client.browser';
import { BridgeContext, type Bridge } from './island-bridge';

type Envelope = {
  buildId: string;
  rscPayload: string;
  identifierPrefix: string;
};
type CallServer = (id: string, args: unknown[]) => Promise<unknown>;
export type IslandHandle = {
  update(envelope: Envelope): void;
  destroy(): void;
  buildId: string;
};
export type MountOptions = {
  envelope: Envelope;
  callServer?: CallServer;
  bridge?: Partial<Bridge>;
  mode: 'hydrate';
  /** Returns a bearer identity token for this remote, or null (design §9a). */
  getToken?: () => Promise<string | null>;
  onError?: (
    error: unknown,
    kind: 'uncaught' | 'caught' | 'recoverable',
  ) => void;
};

const ORIGIN = import.meta.env.NF_ORIGIN as string;
// The build's own base URL: build-pinned when versioned, so actions reach the build that
// rendered the island (design §6 deploy skew).
const BASE = new URL(import.meta.env.BASE_URL, ORIGIN).href;

// Registry slot the scoped flight client reads (see nfScope in vite.config.ts).
const cache = new Map<string, Promise<unknown>>();
const registry = ((globalThis as any).__nf_rsc__ ??= {}) as Record<
  string,
  unknown
>;
registry[ORIGIN] = {
  require(rawId: string) {
    const id = rawId.split('$$cache=')[0]!;
    let mod = cache.get(id);
    if (!mod) {
      mod = import.meta.env.__vite_rsc_build__
        ? ((clientReferences as Record<string, () => Promise<unknown>>)[
            id
          ]?.() ??
          Promise.reject(new Error(`client reference not found '${id}'`)))
        : import(/* @vite-ignore */ new URL(id.slice(1), BASE).href);
      cache.set(id, mod);
    }
    return mod;
  },
  chunkLoad: () => Promise.resolve(),
};

const toStream = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });

// Per-island callServer: posts to THIS remote with a bearer token and no cookies.
function createCallServer(getToken?: () => Promise<string | null>): CallServer {
  const callServer: CallServer = async (id, args) => {
    const token = (await getToken?.()) ?? null;
    const headers: Record<string, string> = { 'x-nf-action': id };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = fetch(`${BASE}_nf/action`, {
      method: 'POST',
      headers,
      body: await encodeReply(args),
      credentials: 'omit',
    });
    const { returnValue } = await createFromFetch<{ returnValue: unknown }>(
      response,
      { callServer },
    );
    return returnValue;
  };
  return callServer;
}

// Defined once so updates keep the same component type (and therefore client state).
function Island({ payload }: { payload: Promise<ReactNode> }) {
  return use(payload);
}

function tree(envelope: Envelope, callServer: CallServer, bridge: Bridge) {
  const payload = createFromReadableStream<ReactNode>(
    toStream(envelope.rscPayload),
    { callServer },
  );
  return (
    <BridgeContext.Provider value={bridge}>
      <Island payload={payload} />
    </BridgeContext.Provider>
  );
}

export function mountIsland(
  container: HTMLElement,
  opts: MountOptions,
): IslandHandle {
  const callServer = opts.callServer ?? createCallServer(opts.getToken);
  const bridge: Bridge = {
    navigate: (h) => location.assign(h),
    prefetch: () => {},
    basePath: '',
    ...opts.bridge,
  };
  const report =
    (kind: 'uncaught' | 'caught' | 'recoverable') => (error: unknown) =>
      opts.onError?.(error, kind);
  const root: Root = hydrateRoot(
    container,
    tree(opts.envelope, callServer, bridge),
    {
      identifierPrefix: opts.envelope.identifierPrefix,
      onUncaughtError: report('uncaught'),
      onCaughtError: report('caught'),
      onRecoverableError: report('recoverable'),
    },
  );
  return {
    buildId: opts.envelope.buildId,
    update(envelope) {
      startTransition(() => root.render(tree(envelope, callServer, bridge)));
    },
    destroy() {
      root.unmount();
    },
  };
}
