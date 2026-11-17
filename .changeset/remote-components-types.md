---
'@next-federation/protocol': minor
'@next-federation/core': minor
'@next-federation/react': minor
'@next-federation/server': minor
'@next-federation/vite': minor
'@next-federation/next': minor
---

Remote components can publish prop types for hosts (opt-in).

- `nextFederationComponents({ types: true })` (off by default in 0.x) emits the exposed modules' TypeScript declarations into the build (`client/@mf-types/`, Module Federation's layout) with the project's own `typescript`, without comments (the `/*!` comments TypeScript's `removeComments` keeps are stripped too) and with paths relative to the Vite root. The literal values of constants (exported or referenced through `typeof`), `as const` objects and enums are published as written, including values inlined from outside the root: don't expose a module whose type graph reaches a secret. A declaration that names an absolute path or a path above the root makes the build warn and publish no types. It writes `client/@mf-types/index.json` (every declaration file with its sha384) and signs that one index in the descriptor's new `types` field (`{ index, integrity }`), so the descriptor stays small. Without `typescript`, or when TypeScript cannot emit the declarations, the build warns and publishes no types. `nf-describe --types` indexes and signs a `client/@mf-types/` folder too (only with `--types`), and `--verify` checks a signed index.
- `nf-types` (`@next-federation/next`) downloads the declarations of each remote's current build into `next-federation-types/`, only from a descriptor verified with the remote's `components.ssr` keys or pins, only through an index and files whose raw bytes match their sha384, every body read with a size limit, and writes `index.d.ts`. `RemoteProps<'shop', './Cart'>` then gives `createRemoteComponent` the remote's real props.
- `verifyDescriptorTrust` and `readBodyLimited` (`@next-federation/core/components`): check a descriptor against a remote's trust policy whether or not the build has server code; read a response body with a byte limit. The descriptor fetch now refuses a body over 1 MiB (`NF-029`) without buffering it.
- Docs: "Types" and "Devtools" sections in `docs/guides/remote-components.md` (the Module Federation Chrome devtools read remote components' snapshot as for any MF host).

**Upgrade hosts before remotes:** an older host computes the descriptor digest without `types`, so it refuses a new remote build with declarations with `NF-027` (rendered in the browser only). Leave `types` off until hosts are upgraded.
