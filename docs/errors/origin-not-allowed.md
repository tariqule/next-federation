# NF-022: Request origin is not an allowed host

## Why This Error Occurred

A request came from a host that is not on the remote's allowed list. Remotes only serve islands to hosts they know.

## Possible Ways to Fix It

- Add the host's origin to the remote's `hosts` option. Each entry must equal the `Origin` header a browser sends: lowercase, no path, no trailing slash.

  ```ts
  // vite.config.ts
  nextFederationIslands({ hosts: ['https://app.example.com'] })
  ```

- Check that a proxy is not changing the `Origin` header.

## Useful Links

- [Writing an island remote: host origins and issuers must match exactly](../guides/writing-an-island-remote.md#host-origins-and-issuers-must-match-exactly)
