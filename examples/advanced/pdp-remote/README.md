# example-pdp-remote

**Remote** (island remote, Vite, remote name `pdp`). PDP (product detail page): serves the product
detail, recommendations and personal picks to the [storefront](../storefront/README.md). It has no
UI of its own.

| Island            | Shows                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProductDetail`   | A public island with a client component (`Gallery`), prerendered into each product page's static shell.                                                                |
| `Recommendations` | Related products as island `Link`s: a click navigates the host without a reload.                                                                                       |
| `ForYou`          | A **private** island: the storefront signs a token for the `pdp` audience, and the island reads the user from it. It streams into the static product page per request. |

With `ForYou` next to the [Account remote](../account-remote/README.md)'s private islands, one
sign-in gives two remotes their own tokens: each is minted for one audience and refused by the
other.

## Run it

Part of the [commerce platform](../README.md) (`pnpm examples:platform`). Alone:
`pnpm --filter example-pdp-remote dev`, or `build` then `start` (nf-serve on 127.0.0.1:13401).
Check it: <http://127.0.0.1:13401/_nf/health>. In the storefront, turn on **How is this page
built?** on a product page: `ProductDetail` arrived in the first HTML, `ForYou` streamed in later.

Guides: [Writing an island remote](../../../docs/guides/writing-an-island-remote.mdx),
[Identity](../../../docs/guides/identity.mdx).
