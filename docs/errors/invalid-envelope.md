# NF-004: Invalid island envelope

## Why This Error Occurred

A remote's response failed envelope schema validation. It may be truncated, come from something other than a next-federation remote, or be an error page served with a success status.

## Possible Ways to Fix It

- Request the island URL directly and inspect the body.
- Confirm the remote route is mounted.
- Confirm the proxy in front of it does not rewrite responses.

## Useful Links

- [Island protocol](../protocol/v1.md)
