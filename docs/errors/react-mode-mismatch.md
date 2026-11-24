# NF-006: Island server and client bundle run different React modes

## Why This Error Occurred

The island was rendered with one React mode (development or production) and hydrates with the other. Mixing modes causes hydration errors that are hard to trace.

## Possible Ways to Fix It

- Build and run the remote with the same `NODE_ENV` on server and client.
- Do not serve a development bootstrap against a production render.

## Useful Links

- [Writing an island remote](../guides/writing-an-island-remote.md)
