# NF-020: Remote `base` must be an absolute URL

## What happened

A remote was configured with a relative `base`.

## Why

The host fetches islands from another origin, so a relative path has nothing to resolve against.

## How to fix

Use a full URL, for example `https://shop.example.com`.
