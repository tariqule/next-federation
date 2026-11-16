# Contributing

Thanks for helping. Please read [AGENTS.md](AGENTS.md) (repo map, commands, hard rules) and
[docs/conventions.md](docs/conventions.md) first, and the README of any package you edit.

## Setup

The workspace needs Node >= 24 and pnpm 10. The published packages target Node >= 20.9.

```sh
pnpm install
pnpm build
```

## Commands

- `pnpm build`: build every package
- `pnpm test`: unit tests (rstest)
- `pnpm typecheck`, `pnpm lint`, `pnpm lint:docs`, `pnpm format:check`
- `pnpm guardrail`: grep guardrail (run before building)
- `pnpm check:error-docs`, `pnpm check:pack`: run after building
- `pnpm e2e`: Playwright suites. Cells: `pnpm e2e:dev`, `e2e:dev:webpack`, `e2e:prod`,
  `e2e:prod:webpack`, `e2e:skew`. `NF_LANE=b` runs on a second port range.

## Pull requests

- Use [conventional commits](https://www.conventionalcommits.org). `commitlint` runs in CI on every
  pull request commit.
- Tests are required: a bug fix needs a test that fails without the fix, and a feature needs tests
  for its behavior. Changes to host or remote behavior need the matching e2e lane.
- Never use Next.js internals: no `next/dist/**` imports, no `__next_*` globals, never `connection()`.
  `pnpm guardrail` and ESLint enforce this.
- Add a changeset (`pnpm changeset`) for any change to a published package.
- Run format, lint, typecheck, build and tests before you push.

## Reporting problems

Bugs and feature requests go through the issue templates. Security problems go through
[SECURITY.md](SECURITY.md), never a public issue. By taking part you agree to the
[Code of Conduct](CODE_OF_CONDUCT.md).
