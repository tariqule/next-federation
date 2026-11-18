# @next-federation/sdk

Shared building blocks for every `next-federation` package: a category logger and the `NF-001` to
`NF-040` error codes, each with a page under
[`docs/errors`](https://github.com/tariqule/next-federation/tree/main/docs/errors).

## Install

```sh
pnpm add @next-federation/sdk
```

## Usage

```ts
import { NFError, isNFError, logger } from '@next-federation/sdk'

logger.warn('NF-024', 'Envelope is 52 KB.')
throw new NFError('NF-001', 'Remote "shop" is not in defineFederation().')
```

`isNFError(value, code?)` checks the `.code` property instead of using `instanceof`, so it still
works when two copies of the package are installed. Set `NF_DEBUG=1` to enable `logger.debug`.

## API

| Export                                                    | Purpose                                        |
| --------------------------------------------------------- | ---------------------------------------------- |
| `NFError`, `isNFError(value, code?)`                      | Coded error class and a duck-typed guard.      |
| `ERROR_CODES`, `errorDocsUrl`, `formatError`, `DOCS_BASE` | Error code table and docs links.               |
| `logger`, `createLogger(prefix, sink?)`                   | Category logger; `NF_DEBUG=1` enables `debug`. |

## Constraints

- Every `NF-xxx` code has a page under `docs/errors`. `scripts/check-error-docs.mjs` fails CI when one is missing.
- Library code logs through `logger` only. `debug` output needs `NF_DEBUG=1`.

## Learn more

- [Error reference](https://github.com/tariqule/next-federation/tree/main/docs/errors)
- [Island protocol v1](https://github.com/tariqule/next-federation/blob/main/docs/protocol/v1.md)
- [Guides](https://github.com/tariqule/next-federation/tree/main/docs/guides)

License: MIT
