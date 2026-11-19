# example-catalog-data

**Shared data**, not an app. The product list the [CDP](../cdp-remote/README.md),
[PDP](../pdp-remote/README.md) and [SERP](../serp-remote/README.md) remotes read on their servers.

In a real company this is a product service or API that each remote calls. Here it is a plain
JavaScript package so the example runs without a database. Hosts never import it: they only embed
the islands the remotes render from it.

Part of the [commerce platform](../README.md).
