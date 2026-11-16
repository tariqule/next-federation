# NF-022: Request origin is not an allowed host

## What happened

A request arrived from a host that is not on the remote's allowed list.

## Why

Remotes only serve islands to hosts they have been told about.

## How to fix

Add the host's origin to the remote's allowed hosts, or check that a proxy is not changing the `Origin` header.
