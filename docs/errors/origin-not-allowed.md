# NF-022: Request origin is not an allowed host

## What happened

A request arrived from a host that is not on the remote's allowed list.

## Why

Remotes only serve islands to hosts they have been told about.

## How to fix

Add the host's origin to the remote's `hosts` option, or check that a proxy is not changing the `Origin` header.

Each `hosts` entry must equal the `Origin` header a browser sends: lowercase, no path, no trailing slash. See [Writing an island remote](../guides/writing-an-island-remote.md#host-origins-and-issuers-must-match-exactly).
