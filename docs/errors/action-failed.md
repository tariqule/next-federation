# NF-033: Server Action threw an error

## What happened

A Server Action on the remote threw. The remote logged this code and the caller's promise rejected.

## Why

The error came from the action's own code (or something it called). In production the error message
sent to the browser is redacted; the remote's log has the details.

## How to fix

Read the remote's server log entry for `NF-033` to find the original error. Handle expected failures
inside the action and return a value (for example an error state for `useActionState`) instead of
throwing.

See [Server Actions: errors](../guides/server-actions.md#errors).
