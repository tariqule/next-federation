---
'@next-federation/server': minor
'@next-federation/vite': minor
---

Remote components: build-side fixes from review.

- `nf-describe` and `nextFederationComponents` never write `fallback: true` for a `react`, `react-dom` or `next` module (any subpath, such as `react-dom/server`, `react/jsx-dev-runtime` or `next/head`), which hosts refuse: `nf-describe` lists such a bundled share as host-provided, and `nextFederationComponents` rejects `fallback: true` for one (`NF-002`).
- Types are opt-in on every build path. `nextFederationComponents` signs `client/@mf-types/` only with `types: true`, never just because the folder exists. `nf-describe` signs it only with the new `--types` flag (`types: true` in `describeComponentsBuild`), and fails (`NF-002`) when `--types` finds no folder. `nf-describe --verify` no longer fails on a build that has an `@mf-types/` folder but no `types` entry (it checks only a signed index). **Rspack and webpack remotes that publish types: add `--types` to your `nf-describe` command.**
- The per-expose declaration entry files (`@mf-types/<Name>.d.ts`) quote their module specifier with double quotes, escaped, so a file name with a quote or backslash stays valid.
- Docs: the `NF-029` page lists the 1 MiB descriptor limit and the `nf-types` failure cases; `nf-describe` is documented in the `@next-federation/server` README.
