# NF-019: This remote build does not support island Server Actions

## What happened

An island tried to call a Server Action, and the remote build that rendered it rejected the call.

## Why

The remote was built with a next-federation release from before island Server Actions shipped. Its
island runtime has no action client, so every Server Action call rejects with `NF-019`. Current
releases do not raise this code.

## How to fix

Rebuild and redeploy the remote with the current `@next-federation/vite` and
`@next-federation/island`. See the Server Actions guide for how to write and pass actions.
