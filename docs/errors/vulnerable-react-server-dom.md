# NF-041: Installed `react-server-dom-webpack` has a known security advisory

## What happened

An island remote's build found a `react-server-dom-webpack` affected by
[GHSA-xqc2-xf4c-x3h3](https://github.com/advisories/GHSA-xqc2-xf4c-x3h3), unauthenticated remote
code execution in React Server Components. `vite build` fails; the Vite dev server logs this as a
warning and goes on.

## Why

An island remote runs `react-server-dom-webpack` on its server to render islands and run Server
Actions. The affected versions are 19.0.0 to 19.0.8, 19.1.0 to 19.1.9, 19.2.0 to 19.2.8 and
19.3.0. The patched versions are **19.0.9**, **19.1.10**, **19.2.9** and **19.3.1**. The message
names the version found, where it was found, and the first patched version of its minor line.

## How to fix

Upgrade `react`, `react-dom` and `react-server-dom-webpack` together, to the same exact patched
version (an island remote keeps all three at one exact version):

```sh
npm install --save-exact react@19.3.1 react-dom@19.3.1 react-server-dom-webpack@19.3.1
```

To stay on your minor line, use its patched version instead (for example `19.2.9`). Remove any
override or resolution that pins an affected version. There is no switch to build with an affected
version.

See [Writing an island remote](../guides/writing-an-island-remote.md).
