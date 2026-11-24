# example-cdp-remote

**Remote** (island remote, Vite, remote name `cdp`). CDP (category page): serves the category
navigation and the product grid to the [storefront](../storefront/README.md). It has no UI of its
own.

| Island        | Shows                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `CategoryNav` | Island `Link`s: host-relative hrefs, the host adds its basePath and locale and navigates with its own router.                  |
| `ProductGrid` | Server data (`example-catalog-data`), a client component of the island (`GridFilters`), and "rendered by the CDP remote at …". |

The storefront prerenders both into its static shells and caches them (an hour on the home page, 10
minutes on category pages: per-island `revalidate`). Its admin's **Publish** button calls
`revalidateIsland('cdp')`, which expires the tag `nf:cdp`: the "rendered at" time then changes.
This is also the remote the platform's outage and redeploy keys act on (`pnpm examples:platform`,
keys **o** and **r**).

## Run it

Part of the [commerce platform](../README.md): `pnpm examples:platform` from the repository root
builds and starts everything. Alone:

```sh
pnpm --filter example-cdp-remote dev      # Vite dev server on 127.0.0.1:13400
pnpm --filter example-cdp-remote build    # dist/<buildId>/ (NF_BUILD_ID, else the time)
pnpm --filter example-cdp-remote start    # nf-serve: every kept build, on 13400
```

Check it: <http://127.0.0.1:13400/_nf/health>. In the storefront, turn on **How is this page
built?** to see each CDP island's build id, cache mode and tags.

`vite.config.ts` lists the hosts that may embed it (`hosts`, the CORS allowlist) and the issuer
whose tokens it accepts. Guide: [Writing an island remote](../../../docs/guides/writing-an-island-remote.mdx).
