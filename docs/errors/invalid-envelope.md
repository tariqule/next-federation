# NF-004: Invalid island envelope

## What happened

The response from a remote was not a well-formed island envelope.

## Why

The body failed schema validation: it may be truncated, produced by something other than a next-federation remote, or an error page served with a success status.

## How to fix

Request the island URL directly and inspect the body. Confirm the remote route is mounted and the proxy in front of it is not rewriting responses.
