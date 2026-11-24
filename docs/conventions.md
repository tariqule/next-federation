# Code conventions

Conventions for the `next-federation` packages. Read [AGENTS.md](../AGENTS.md) for the repo map and
the hard rules, and [CONTRIBUTING.md](../CONTRIBUTING.md) for the pull request process. The
conventions follow the Next.js and Module Federation repositories.

## Formatting and linting

- Prettier, with the Next.js settings: `{ "trailingComma": "es5", "singleQuote": true, "semi": false }`.
- ESLint flat config (`eslint.config.mjs`) with the `typescript-eslint` recommended rules.
- `.editorconfig`: 2 spaces, UTF-8, final newline.
- `.alexrc` configures an inclusive-language lint for docs (`pnpm lint:docs`).
- `no-restricted-imports` bans `next/dist/**`. CI also greps for `__RSC_MANIFEST`, `__next_*`,
  `__next_f` and `connection(` in the adapters (`pnpm guardrail`).

## Tests

- Unit tests use rstest, in `__tests__/*.spec.ts` beside each package's `src/`.
- End-to-end tests use Playwright. Each suite runs in development (`next dev`) and production
  (`next build && next start`), under Turbopack and webpack.
- Test fixtures are real apps under `test/fixtures/`: an App Router host, a Pages Router host, a Vite
  SPA host, island remotes and a components remote.
- A test never silently reuses a server on a busy port (`reuseExistingServer: false`).

## Packages

- Scoped packages named `@next-federation/<name>`, like `@module-federation/<name>`.
- Each package has `src/`, `__tests__/`, `README.md`, `CHANGELOG.md`, `tsconfig.json`,
  `tsconfig.lib.json`, `tsdown.config.ts` (builds to `dist/`) and an `exports` map.
- Releases use changesets. Commits follow conventional commits (commitlint). See
  [Releasing](releasing.md).

## Errors and logging

- Library code logs through a category logger, `createLogger('[ next-federation ]')`. No bare
  `console.*`.
- Errors have numbered codes (`NF-001` and up) in the `error-codes` module of
  `@next-federation/sdk`.
- Every user-facing error message links to a docs page, `docs/errors/<slug>.md`. Each page says why
  the error occurred and how to fix it. `pnpm check:error-docs` fails when a code has no page, or when a
  page is `.mdx` (the library links to the `.md` URL, see [Documentation style](maintainers/docs-style.md)).

## Docs

- Every package folder has a `README.md` (plain Markdown, for npm). Read the READMEs on the path
  before you edit a file.
- Pages in `docs/` are `.mdx` and follow [Documentation style](maintainers/docs-style.md): the
  Next.js docs style, with Fumadocs components and a word budget per page
  (`node scripts/docs-prose-words.mjs docs`). Error pages stay `.md`.
- A new page is listed in `docs-site/scripts/sync-content.mjs` (URL and sidebar order). The guides
  under `docs/guides/` are task flows. Detail goes to a `-reference` page, Limits or Architecture.
- Renaming a page that a released version links to leaves a stub at the old path.
- Write in plain, direct prose. Use the same terms throughout: islands, remote components, host,
  remote, build, descriptor, envelope.
- Change docs in the same pull request as the behavior they describe.

## Git

- Do not add tool attribution to commit messages, pull request descriptions or repository
  descriptions.
