# NF-003: Unsupported island protocol version

## Why This Error Occurred

An envelope declared a protocol version this host does not understand. Host and remote run different major versions of the island protocol.

## Possible Ways to Fix It

- Upgrade the older side so both run compatible `@next-federation/*` versions. The message lists the versions seen.

## Useful Links

- [Island protocol](../protocol/v1.md)
