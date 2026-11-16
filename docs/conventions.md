# Engineering conventions for the main library

These apply to the real `next-federation` packages, starting in Phase 1. The `spike/` folder is
throwaway code and doesn't follow them.

Sources: the Next.js repo (`vercel/next.js`) and the Module Federation repo
(`module-federation/core`). Where they conflict, the user chose (2026-11-14) as noted.

## Formatting and linting: Next.js style
- Prettier, matching Next.js `.prettierrc.json`: `{ "trailingComma": "es5", "singleQuote": true, "semi": false }`.
- ESLint flat config (`eslint.config.mjs`) with `typescript-eslint` recommended, as Next.js does.
- `.editorconfig`: 2 spaces, UTF-8, final newline (both repos agree).
- `.alexrc` inclusive-language lint for docs (Next.js).
- Lint guardrail: `no-restricted-imports` bans `next/dist/**`. CI also greps for `__RSC_MANIFEST`,
  `__next_*`, `__next_f` and `connection(` in adapters (design §11).

## Tests
- Unit tests use **rstest** (Module Federation), in `__tests__/*.spec.ts` beside each package's `src/`.
- e2e tests use **Playwright**. Following Next.js, every e2e suite runs in **both development
  (`next dev`) and production (`next build && next start`)**, under **both Turbopack and webpack**.
- Test fixtures are real apps under `test/fixtures/` (App Router host, Pages Router host, Vite SPA
  host, island remotes, a Mode A remote). The spike apps are the starting point.
- No test may silently reuse a server on a busy port (`reuseExistingServer: false`).

## Packages (Module Federation layout)
- Scoped packages, `@next-federation/<name>` (mirrors `@module-federation/<name>`).
- Each package has `src/`, `__tests__/`, `README.md`, `CHANGELOG.md`, `tsconfig.json`,
  `tsconfig.lib.json`, `tsdown.config.ts` (build to `dist/`), and an `exports` map.
- Releases use **changesets**. Commits follow **conventional commits** (commitlint), as in Module Federation.

## Errors and logging
- A category logger, `createLogger('[ next-federation ]')`, as Module Federation does for
  `[ Federation Runtime ]`. No bare `console.*` in library code.
- Numbered error codes (`NF-001`…) in an `error-codes` module, as Module Federation does (`RUNTIME-008`).
- Every user-facing error message links a docs page, `docs/errors/<slug>.md`, as Next.js does with
  `nextjs.org/docs/messages/<slug>`.

## Docs for contributors (Next.js)
- `AGENTS.md` at the root: structure, commands, conventions.
- A `README.md` in every package folder. Read the READMEs on the path before editing a file.

## Git
- No tool attribution in commit messages, PR descriptions or repo descriptions.
