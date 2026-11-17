# NF-032: Server Action request is invalid

## What happened

The remote rejected a request to `/_nf/action` with `400` before running any action.

## Why

The `X-NF-Action` header is missing or malformed, the `island` query parameter is not a valid island
name, the content type is not `text/plain;charset=UTF-8` or `multipart/form-data`, or the body could
not be decoded as Server Action arguments. A plain HTML form post or `sendBeacon` call fails this way
by design.

## How to fix

Call Server Actions from an island through the island runtime (for forms, use `<Form>` from
`@next-federation/island`); do not post to `/_nf/action` by hand. Make sure host and remote run the
same React version.
