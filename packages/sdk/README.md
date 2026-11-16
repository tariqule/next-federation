# @next-federation/sdk

Shared building blocks for every `next-federation` package: a category logger and the
`NF-001` to `NF-030` error codes, each with a docs page under
[`docs/errors`](https://github.com/tariqule/next-federation/tree/main/docs/errors).

```ts
import { NFError, isNFError, logger } from '@next-federation/sdk'

logger.warn('NF-024', 'Envelope is 52 KB.')
throw new NFError('NF-001', 'Remote "shop" is not in defineFederation().')
```

`isNFError(value, code?)` is duck-typed on `.code`, so it keeps working when two copies of the
package are installed. Set `NF_DEBUG=1` to enable `logger.debug`.

## Install

```sh
pnpm add @next-federation/sdk
```

## API

| Export                                                    | Purpose                                        |
| --------------------------------------------------------- | ---------------------------------------------- |
| `NFError`, `isNFError(value, code?)`                      | Coded error class and a duck-typed guard.      |
| `ERROR_CODES`, `errorDocsUrl`, `formatError`, `DOCS_BASE` | Error code table and docs links.               |
| `logger`, `createLogger(prefix, sink?)`                   | Category logger; `NF_DEBUG=1` enables `debug`. |

The protocol the packages speak is specified in [`docs/protocol/v1.md`](https://github.com/tariqule/next-federation/blob/main/docs/protocol/v1.md).

License: MIT

## Constraints

- Every `NF-xxx` code has a page under `docs/errors`; `scripts/check-error-docs.mjs` fails CI when one is missing.
- Library code logs through `logger` only. `debug` output needs `NF_DEBUG=1`.

Guides: [docs/guides](https://github.com/tariqule/next-federation/tree/main/docs/guides).
