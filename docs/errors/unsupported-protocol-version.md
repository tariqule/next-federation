# NF-003: Unsupported island protocol version

## What happened

An envelope declared a protocol version this host does not understand.

## Why

Host and remote are on different major versions of the island protocol, so the host cannot safely interpret the envelope.

## How to fix

Upgrade the older side so both run compatible `@next-federation/*` versions. The error detail lists the versions seen.
