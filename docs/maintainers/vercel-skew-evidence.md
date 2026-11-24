# Vercel skew evidence

What was observed when an island remote was deployed to Vercel. Tested on 2026-11-16 with Vercel CLI
65.16.0 on the Hobby plan: a project with two production deployments, embedded by the e2e `host-app`
(a Next production build) running locally. `test/e2e/vercel.spec.ts` passed 4 of 4. Skew Protection
is not available on Hobby, so it was not tested.

The user-facing guide is [Deploying an island remote on Vercel](../guides/deploying-a-remote-on-vercel.mdx).

## Requests

| Request                                                         | Answer                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| production domain, `/_nf/health` and `/_nf/island/...`          | `200`, no login                                                                 |
| production domain, `/b/<current>/assets/*`                      | `200`, `Access-Control-Allow-Origin: *`, `immutable`                            |
| generated deployment URL, any path (static files too)           | `302` to `https://vercel.com/sso-api?...`; `401` for `Accept: application/json` |
| production domain after a new deploy, `/b/<old>/assets/*`       | `404`                                                                           |
| production domain after a new deploy, `/b/<old>/_nf/island/...` | `410 NF-023` (from `api/nf.ts`)                                                 |
| the same, with `?dpl=<old deployment id>` or `x-deployment-id`  | unchanged: the deployment id does not pin the request on Hobby                  |

Also observed:

- After a rewrite, the Function's `request.url` keeps the requested path. Vercel adds the rewrite's
  named parameters (`path`, `build`) to the query. The island handler reads only `p` and `h`.
- Deployment Protection was on by default. `vercel project protection` reports
  `"ssoProtection": { "deploymentType": "all_except_custom_domains" }` (Standard Protection), and each
  deployment reports `"deploymentProtection": ["vercel_authentication"]`. The production `*.vercel.app`
  domain stayed public.
- `vercel build` ran `pnpm install` for the whole workspace, even with `"installCommand": ""`.
- A prebuilt build has no System Environment Variables: `vercel build` did not set
  `VERCEL_PROJECT_PRODUCTION_URL`, and `vercel pull` did not write it.
- `vercel link` writes `VERCEL_OIDC_TOKEN` to `.env.local`. `vercel pull` and `vercel build --yes` write
  it to `.vercel/.env.production.local`.

## An island across a deploy

A page whose island the previous build rendered (a cached host page or envelope, or an open tab) loads
after the new deploy. The host page is `200`, every request under `/b/<old>/` gets `404`, the bootstrap
import fails, and the island goes inert (`data-nf-state="inert"`). The library emits an `island:error`
event with kind `bootstrap`.

The server HTML stays on the page, unstyled where its CSS also 404s, and ignores clicks. The host shows
no fallback and the page has no uncaught errors. A reload that renders the current build shows a live
island.

The test replays such a page by rewriting the build prefix in the host's HTML to the previous build's
id. On the production domain every request under that prefix reaches the new deployment, so the browser
sees what a cached page of the previous build sees. The previous deployment does not keep answering its
build-pinned paths on Hobby. Only its generated URL answers, behind Vercel Authentication.

## e2e results

| Test                                                                                            | Result |
| ----------------------------------------------------------------------------------------------- | ------ |
| the production domain serves envelopes and assets without auth (Deployment Protection on)       | passed |
| a generated deployment URL is behind auth and is never used in an envelope                      | passed |
| an island rendered by the previous deployment degrades cleanly after a new deploy               | passed |
| the previous deployment no longer answers its build-pinned island path on the production domain | passed |

## The Vercel e2e job

`.github/workflows/vercel.yml` is a manual (`workflow_dispatch`) job, `e2e-vercel`. It needs the secrets
`VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`, and the production domain as an input. It builds
and deploys the fixture twice to production, then runs `test/e2e/vercel.spec.ts` against the local
`host-app`. It never runs on push or pull requests.

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

- [Skew Protection](https://vercel.com/docs/skew-protection)
- [Deployment Protection](https://vercel.com/docs/deployment-protection)
- [System environment variables](https://vercel.com/docs/environment-variables/system-environment-variables)
- [`vercel deploy`](https://vercel.com/docs/cli/deploy) and [`vercel build`](https://vercel.com/docs/cli/build)
- [Global options](https://vercel.com/docs/cli/global-options)
- [Node.js runtime and the Web `fetch` export](https://vercel.com/docs/functions/runtimes/node-js)
- [Rewrites](https://vercel.com/docs/routing/rewrites)
- [`vercel.json`](https://vercel.com/docs/project-configuration/vercel-json)
