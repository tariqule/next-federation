# Deploying an island remote on Vercel

An island remote runs on Vercel as static files plus one Vercel Function. Hosts reach it at the
project's **production domain**, never at a generated deployment URL.

**Verified** on 2026-11-16 with Vercel CLI 65.16.0 on the **Hobby** plan: project
`next-federation-island-remote` (production domain `https://next-federation-island-remote.vercel.app`),
two production deployments, embedded by the e2e `host-app` (Next production build) running locally.
`test/e2e/vercel.spec.ts` passed 4 of 4. Skew Protection is not available on Hobby, so nothing here
verifies it.

## Layout

| Path                    | Served by                                                                  |
| ----------------------- | -------------------------------------------------------------------------- |
| `/b/<build>/assets/*`   | Vercel's static output, with CORS `*` and `immutable` from `vercel.json`   |
| `/_nf/*`                | the Function `api/nf.ts`, through a `vercel.json` rewrite                  |
| `/b/<build>/_nf/*`      | the same Function: answers for its own build, `410 NF-023` for any other   |
| an earlier build's file | `404` (Vercel `NOT_FOUND`): a deployment holds only its own build          |

One deployment holds one build. The fixture `test/fixtures/island-remote` is a working example:
`vite.config.ts` (Vercel branch), `scripts/vercel-build.ts`, `api/nf.ts` and `vercel.json`.

## Setup

1. **Base.** Set the plugin's `base` to the production domain. Vercel provides it, without the scheme,
   as `VERCEL_PROJECT_PRODUCTION_URL`:

   ```ts
   nextFederationIslands({
     base: `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/`,
     // ...
   })
   ```

   Do not use `VERCEL_URL` or any `*-<hash>.vercel.app` URL. With Deployment Protection those URLs
   need a Vercel login, so browsers on the host's pages cannot load the island's assets from them.
   The base is https, which production builds require.

2. **Build script** (`buildCommand` in `vercel.json`). It runs `vite build`, then:
   - copies `dist/<build>/client/` to `<outputDirectory>/b/<build>/`, so the assets are served at
     the build-pinned paths the envelope names;
   - writes a fixed-path module (`dist/vercel/entry.js`) that re-exports the build's
     `rsc/index.js` handler and its `buildId`. The Function imports it statically, so Vercel's file
     tracing bundles every server chunk.

3. **Function** `api/nf.ts`: a Web `fetch` export that calls the build's handler. A path pinned to
   another build (`/b/<other>/_nf/...`) gets `410 {"error":"NF-023"}` with CORS `*`, the same answer
   `nf-serve` gives for a retired build. Without that check the handler would answer an earlier
   build's pinned path with the current build.

4. **`vercel.json`**:

   ```json
   {
     "framework": null,
     "installCommand": "",
     "buildCommand": "node scripts/vercel-build.ts",
     "outputDirectory": "dist/vercel/static",
     "rewrites": [
       { "source": "/_nf/:path*", "destination": "/api/nf" },
       { "source": "/b/:build/_nf/:path*", "destination": "/api/nf" }
     ],
     "headers": [
       {
         "source": "/b/:build/assets/:file*",
         "headers": [
           { "key": "Access-Control-Allow-Origin", "value": "*" },
           { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
         ]
       }
     ]
   }
   ```

   Hosts load the bootstrap as a cross-origin module script and the CSS as stylesheets, so the
   assets need `Access-Control-Allow-Origin`.

5. **Deploy.** In a pnpm workspace, build on your machine or in CI and upload the output:

   ```sh
   vercel link --project <project>
   VERCEL_PROJECT_PRODUCTION_URL=<project>.vercel.app vercel build --prod
   vercel deploy --prebuilt --prod
   ```

   A prebuilt build has no System Environment Variables. `vercel build` did not set
   `VERCEL_PROJECT_PRODUCTION_URL`, and `vercel pull` did not write it, so set it yourself as above. A
   build that Vercel runs (Git integration, or `vercel deploy` without `--prebuilt`) sets it.
   `vercel deploy --json` prints the deployment id and URL.

### What the CLI writes to disk

- `vercel link` writes `VERCEL_OIDC_TOKEN` to `.env.local`, and `vercel pull` / `vercel build --yes`
  write it to `.vercel/.env.production.local`. Keep `.vercel/` and `.env*` out of git, and delete
  those files when you are done.
- `vercel build` ran `pnpm install` for the whole workspace to build the Function, even with
  `"installCommand": ""`.

## Observed behaviour (Hobby, 2026-11-16)

| Request                                                         | Answer                                                            |
| --------------------------------------------------------------- | ----------------------------------------------------------------- |
| production domain, `/_nf/health` and `/_nf/island/...`          | `200`, no login                                                   |
| production domain, `/b/<current>/assets/*`                      | `200`, `Access-Control-Allow-Origin: *`, `immutable`              |
| generated deployment URL, any path (static files too)           | `302` to `https://vercel.com/sso-api?...`; `401` for `Accept: application/json` |
| production domain after a new deploy, `/b/<old>/assets/*`       | `404`                                                             |
| production domain after a new deploy, `/b/<old>/_nf/island/...` | `410 NF-023` (from `api/nf.ts`)                                   |
| the same, with `?dpl=<old deployment id>` or `x-deployment-id`  | unchanged: the deployment id does not pin the request on Hobby    |

Also observed:

- After a rewrite, the Function's `request.url` keeps the path that was asked for
  (`/b/<build>/_nf/island/...`). Vercel adds the rewrite's named parameters to the query (`path`,
  `build`); the island handler reads only `p` and `h`, so they do no harm.
- Deployment Protection was on by default for the new project: `vercel project protection` reports
  `"ssoProtection": { "deploymentType": "all_except_custom_domains" }` (Standard Protection), and each
  deployment reports `"deploymentProtection": ["vercel_authentication"]`. The production
  `*.vercel.app` domain stayed public.

### What an island does across a deploy

The four e2e tests and their results:

| Test                                                                                                   | Result |
| ------------------------------------------------------------------------------------------------------ | ------ |
| the production domain serves envelopes and assets without auth (Deployment Protection on)             | passed |
| a generated deployment URL is behind auth and is never used in an envelope                             | passed |
| an island rendered by the previous deployment degrades cleanly after a new deploy                      | passed |
| the previous deployment no longer answers its build-pinned island path on the production domain        | passed |

A page whose island was rendered by the previous build (a host page or envelope still cached, or a
tab left open) loads after the new deploy: the host page is `200`, every request under
`/b/<old>/` gets `404`, the bootstrap import fails, and the island goes **inert**
(`data-nf-state="inert"`; the library also emits an `island:error` event with kind `bootstrap`). Its
server HTML stays on the
page, unstyled where its CSS also 404s, and it does not react to clicks. The host shows no fallback,
and the page has no uncaught errors. A reload that renders the current build shows a live island.

The test replays such a page by rewriting the build prefix in the host's HTML to the previous build's
id. On the production domain every request under that prefix reaches the new deployment, so the
browser sees exactly what a cached page of the previous build sees. Requests for the previous build's
real files also got `404`.

The original plan expected the previous deployment to keep answering its build-pinned paths. On Hobby
it does not: only its generated URL still answers, behind Vercel Authentication.

## Skew: choose one

1. **Accept a short inert window** (what was verified). After a deploy, an island from a cached
   envelope stays inert until the host renders a fresh envelope: at most the host's island
   `revalidate` (60 seconds by default) plus one regeneration for ISR pages, or until an open tab
   navigates. Shorten it with `revalidateIsland` / `revalidateTag('nf:<remote>')` from a deploy
   hook. Works on every plan.
2. **Skew Protection** (Pro and Enterprise). **Not verified by this project.** From Vercel's docs:
   requests that carry the deployment id (`?dpl=` or `x-deployment-id`, or the `__vdpl` cookie for
   some frameworks) reach the deployment that rendered the page, but cross-origin requests ignore the
   deployment id unless the host's domain is listed under **Allowed Domains for Cross-Site Fetch**,
   and only for the configured maximum age. Islands are always cross-origin, and the library adds no
   deployment id to asset URLs today: the bootstrap's own chunk imports could not carry `?dpl=`.
   Treat this option as unproven for islands.
3. **Persistent asset storage.** Keep every build's `/b/<build>/` files somewhere that outlives a
   deployment, such as Vercel Blob, S3 or a CDN bucket, and point `base` there (the host lists that
   origin in the remote's `assetOrigins`). A cached page of an earlier build then still hydrates: its
   payload is in the page and its assets still load. Its build-pinned island path still gets `410`,
   because the earlier handler is gone. Not verified by this project. Delete old builds on the
   schedule `nf-serve` uses ([Self-hosted build retention](self-hosted-skew.md)).

## Deployment Protection

- **Standard Protection** (the default, every plan) protects generated deployment URLs and leaves
  production domains public. That is what an island remote needs.
- **All Deployments** protects the production domain too. Hosts then cannot fetch envelopes, and
  browsers cannot load assets. Do not use it for a remote.
- A host pointed at a generated URL gets `401` on its server-side envelope fetch (observed with
  `Accept: application/json`), so it would show the island's fallback (not run end to end). Use the
  production domain in the host's `remotes` config.
- To test a preview deployment from a host, use a Protection Bypass for Automation secret. This
  project did not test it.

## CI

`.github/workflows/vercel.yml` is a manual (`workflow_dispatch`) job, `e2e-vercel`. It needs the
secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`, and the production domain as an input.
It builds and deploys the fixture twice to production, then runs `test/e2e/vercel.spec.ts` against
the local `host-app`. It never runs on push or pull requests.

To run the spec yourself after two deploys:

```sh
NF_MODE=prod NF_APPS=host-app \
NF_VERCEL_PROD_URL=https://<project>.vercel.app \
NF_VERCEL_OLD_DEPLOYMENT_ID=<dpl_… of the first deploy> \
NF_VERCEL_OLD_DEPLOYMENT_URL=<its https://…vercel.app URL> \
NF_VERCEL_OLD_BUILD_ID=<its island buildId> \
pnpm --filter e2e exec playwright test vercel
```

## Vercel docs used

- Skew Protection: <https://vercel.com/docs/skew-protection>
- Deployment Protection: <https://vercel.com/docs/deployment-protection>
- System environment variables: <https://vercel.com/docs/environment-variables/system-environment-variables>
- `vercel deploy` (`--prebuilt`, stdout, "When not to use --prebuilt"): <https://vercel.com/docs/cli/deploy>
- `vercel build`: <https://vercel.com/docs/cli/build>
- Global options (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`): <https://vercel.com/docs/cli/global-options>
- Node.js runtime and the Web `fetch` export: <https://vercel.com/docs/functions/runtimes/node-js>
- Rewrites: <https://vercel.com/docs/routing/rewrites>
- `vercel.json` (`buildCommand`, `installCommand`, `outputDirectory`, `framework`): <https://vercel.com/docs/project-configuration/vercel-json>
