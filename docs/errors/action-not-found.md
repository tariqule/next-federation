# NF-031: Server Action not found

## What happened

The remote answered a Server Action request with `404` because it has no action with the id in the
`X-NF-Action` header.

## Why

The id names a file or export that is not a `'use server'` function in the build that served the
request. Usually the page was rendered by one build and the action was sent to another, the export
was renamed or removed, or the export is a plain function in a `'use server'` file that the bundler
did not register as a Server Action.

## How to fix

Reload the page so the island and its action ids come from the same build. Check that the function
is exported from a file that starts with `'use server'` and that the remote build in use contains
it.

See [Server Actions: errors](../guides/server-actions.md#errors).
