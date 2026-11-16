# Releasing

Releases are driven by changesets and `.github/workflows/release.yml`. Every `@next-federation/*`
package is versioned together (see `fixed` in `.changeset/config.json`).

## Flow

1. Each pull request that changes a published package adds a changeset (`pnpm changeset`).
2. On every push to `main`, the Release workflow opens or updates a "Version Packages" pull request
   that bumps versions and writes the changelogs.
3. Merging that pull request runs the workflow again. With no pending changesets it runs
   `pnpm release` (`pnpm build`, then `changeset publish`), which publishes to npm with provenance
   and tags the release.

The workflow publishes nothing until npm is set up as described below.

## One-time setup

1. **Create the npm organization.** On npmjs.com create the `next-federation` organization (the scope
   is `@next-federation`). Enable two-factor authentication on the account.
2. **First publish with a token.** A trusted publisher can only be configured for a package that
   already exists, so the first release uses a token:
   - Create a granular access token (or a classic automation token) that can publish to the
     `@next-federation` scope.
   - Add it as the repository secret `NPM_TOKEN` (Settings, Secrets and variables, Actions).
   - Merge the first "Version Packages" pull request. The workflow publishes all 8 packages with
     provenance.
3. **Configure a trusted publisher for each package.** For each of the 8 packages, on npmjs.com open
   the package, Settings, Trusted Publisher, choose GitHub Actions and enter: owner `tariqule`,
   repository `next-federation`, workflow filename `release.yml`. Leave the environment empty
   unless you add one to the workflow.
4. **Remove the token.** Delete the `NPM_TOKEN` repository secret and revoke the token on npm.
   From now on the workflow authenticates with GitHub's OIDC identity (`id-token: write`). The
   workflow installs npm 11.5.1 or newer, which trusted publishing requires.

Check the current npm documentation on trusted publishers if a step above has changed.

## Notes

- Provenance is on (`NPM_CONFIG_PROVENANCE: true`). It needs a public repository, and the
  `repository` field in each package's `package.json` must match this repository.
- Run `pnpm build && pnpm check:pack` locally before merging a Version Packages pull request if you
  want to inspect the tarballs.
