# NF-002: Invalid federation configuration

## What happened

The object passed to `defineFederation()` or `withNextFederation()` failed validation.

## Why

A required field is missing, has the wrong type, or two fields contradict each other. The error detail names the offending path.

A common case: a URL (remote origin, asset origin, `base`, issuer or JWKS URL) uses plain `http` for a host other than `localhost`, `127.0.0.0/8` or `[::1]` outside development. Plain `http` is accepted only when `NODE_ENV` is `development` or `test`, or with `allowInsecureHttp: true`.

Another: `withNextFederation()` got `cacheComponents` (or Next 15's `experimental.cacheComponents` or `experimental.dynamicIO`) with Next.js 15 installed. next-federation supports `cacheComponents` on Next.js 16 only; on Next.js 15 it uses the legacy caching model (fetch `revalidate` and tags).

## How to fix

Fix the field named in the message. For `cacheComponents` on Next.js 15, remove the option or upgrade to Next.js 16. For a plain-`http` URL, switch it to `https`; set `allowInsecureHttp: true` only when the traffic is protected some other way (it logs a warning once per process). Configuration is validated at startup so a bad value never reaches production traffic.
