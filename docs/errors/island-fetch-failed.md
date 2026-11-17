# NF-007: Island fetch failed

## What happened

The host could not fetch an island from its remote.

## Why

The request failed with a network error or a non-success status: the remote may be down, unreachable from the host, or returning an error. A response body larger than the remote's `maxBytes` (`islands.maxBytes`, 5 MiB by default) also fails this way: the host stops reading it and does not retry.

## How to fix

Check that the remote is running and reachable from the host's network. The error detail includes the URL and status; the original error is attached as `cause`.
