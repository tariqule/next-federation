# @next-federation/sdk

Error codes and the category logger that every `next-federation` package shares. Each `NF-001` to `NF-041` code has a page under [`docs/errors`](https://github.com/tariqule/next-federation/tree/main/docs/errors).

## Install

```npm
npm install @next-federation/sdk
```

## Usage

```ts
import { NFError, isNFError, logger } from '@next-federation/sdk'

logger.warn('NF-024', 'Envelope is 52 KB.')
throw new NFError('NF-001', 'Remote "shop" is not in defineFederation().')
```

## API

### NFError(code, detail?, options?)

An `Error` subclass. Its message is the formatted error, `.code` is the `NF-xxx` code, `.docs` is the docs URL, and `options.cause` sets `cause`.

```ts
throw new NFError('NF-001', 'Remote "shop" is not in defineFederation().')
```

### isNFError(value, code?)

Returns `true` when `value` is an `NFError`, optionally with the given code. It checks the `.code` property instead of using `instanceof`, so it still works when two copies of the package are installed.

```ts
try {
  await render()
} catch (error) {
  if (isNFError(error, 'NF-007')) showFallback()
}
```

### logger

A `Logger` with the prefix `[ next-federation ]`. `warn`, `error` and `warnOnce` take an error code and an optional detail string. `debug` and `info` take any arguments, and `debug` prints only when `NF_DEBUG` is set to something other than `0` or `false`.

| Method                         | Description                                             |
| ------------------------------ | ------------------------------------------------------- |
| `debug(...args)`               | Prints only when `NF_DEBUG=1`.                          |
| `info(...args)`                | Always prints.                                          |
| `warn(code, detail?)`          | Prints the formatted error with a docs link.            |
| `error(code, detail?, cause?)` | Prints the formatted error, and `cause` when it is set. |
| `warnOnce(code, key, detail?)` | Like `warn`, once per `code` and `key` for each logger. |

### createLogger(prefix, sink?)

Creates a `Logger` with your own prefix. `sink` defaults to `console` and must have `debug`, `info`, `warn` and `error` methods.

### ERROR_CODES

A record that maps each `NFErrorCode` to its `slug` and `title`.

### errorDocsUrl(code)

Returns the URL of the docs page for an error code.

### formatError(code, detail?)

Returns the message the logger prints: the code, its title, the optional detail and the docs link.

### DOCS_BASE

The base URL every error docs link starts with.

### Types

`NFErrorCode`, `Logger` and `LogSink`.

## Learn more

- [Error reference](https://github.com/tariqule/next-federation/tree/main/docs/errors)
- [Island protocol v1](https://github.com/tariqule/next-federation/blob/main/docs/protocol/v1.md)

License: MIT
