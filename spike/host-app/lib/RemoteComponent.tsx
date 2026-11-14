'use client';
import { createInstance } from '@module-federation/runtime';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as JSXRuntime from 'react/jsx-runtime';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';

// Mode A, browser-only in v1.0 (design §6/§7): the remote renders inside the host tree using the
// HOST's React, which this module (compiled in the browser layer) provides as shared singletons.
type Instance = ReturnType<typeof createInstance>;
let instance: Instance | undefined;
const share = (lib: unknown) => ({
  version: React.version,
  lib: () => lib,
  shareConfig: { singleton: true, requiredVersion: false as const },
});
function getInstance(): Instance {
  return (instance ??= createInstance({
    name: 'host_app',
    remotes: [{ name: 'spa', entry: 'http://localhost:4200/mf-manifest.json' }],
    shared: {
      react: share(React),
      'react-dom': share(ReactDOM),
      // Subpaths too, or a remote falls back to its own copy (design §7).
      'react-dom/client': share(ReactDOMClient),
      'react/jsx-runtime': share(JSXRuntime),
    },
  }));
}

export function RemoteComponent({
  module,
  props,
  fallback,
}: {
  module: string;
  props?: object;
  fallback: ReactNode;
}) {
  const [Comp, setComp] = useState<ComponentType<any> | null>(null);
  useEffect(() => {
    let alive = true;
    getInstance()
      .loadRemote<{ default: ComponentType<any> }>(
        `spa/${module.replace(/^\.\//, '')}`,
      )
      .then((m) => alive && m && setComp(() => m.default))
      .catch((e) => console.error('[next-federation] Mode A load failed:', e));
    return () => {
      alive = false;
    };
  }, [module]);
  return Comp ? <Comp {...props} /> : <>{fallback}</>;
}
