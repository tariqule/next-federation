# Security policy

## Supported versions

`next-federation` is at 0.x. Only the latest minor release of each `@next-federation/*` package
receives security fixes. All packages are versioned together, so upgrade them as a set.

| Version         | Supported |
| --------------- | --------- |
| latest 0.x minor | yes       |
| older 0.x       | no        |

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub private vulnerability reporting:
[Report a vulnerability](https://github.com/tariqule/next-federation/security/advisories/new).

Include the affected package and version, what an attacker can do, and a minimal reproduction if you
have one. If private reporting is unavailable to you, open a public issue that says only that you
have a security report, with no details, and a maintainer will arrange a private channel.

## What is in scope

- Identity tokens: minting, verification, key handling, and anything that could leak a token into
  HTML, prerendered output, Next's RSC payload, `__NEXT_DATA__` or browser storage.
- Island envelope trust: how a host fetches, validates and renders a remote's island envelope.
- Mode A (client components) remote-code evaluation: descriptor signing and pinning, sha384 integrity
  checks, and the conditions under which a host evaluates a remote's server build.
- `nf-serve`, the static build server shipped in `@next-federation/server`.

Problems in Next.js, Vite, React or Module Federation themselves belong with those projects.

## What to expect

This is a solo-maintained project. Reports are handled on a best-effort basis: I aim to acknowledge a
report within a week and to agree a fix and disclosure timeline with you. Fixes ship as a patch
release of the latest minor, with a published security advisory crediting the reporter if you wish.
