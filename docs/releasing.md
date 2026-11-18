# Releasing

Every `@next-federation/*` package is versioned together (see `fixed` in `.changeset/config.json`).
Versioning is automatic. Publishing is manual.

- `.github/workflows/release.yml` ("Version Packages") runs on every push to `main` and opens or
  updates a "Version Packages" pull request from the pending changesets. It never publishes.
- `.github/workflows/publish.yml` ("Publish to npm") runs only when a maintainer starts it. It
  publishes every package whose version is not on npm yet, with provenance, and pushes the release
  tags.

## Flow

1. Each pull request that changes a published package adds a changeset (`pnpm changeset`).
2. After merges to `main`, the "Version Packages" pull request bumps the versions and writes the
   changelogs. Review it and merge it when you want a release. Merging it publishes nothing.
3. Run the publish workflow: **Actions → Publish to npm → Run workflow** (branch `main`).
   - Leave **Dry run** ticked first: it builds, checks the tarballs (`pnpm check:pack`) and runs
     `pnpm publish --dry-run` for each package, so you can read what would be published.
   - Run it again with **Dry run** unticked to publish. It refuses to run while changesets are
     pending (merge the Version Packages pull request first), runs `pnpm release` (`pnpm build`,
     then `changeset publish`, which skips versions already on npm) and pushes the tags.

The job runs in the `npm-publish` GitHub environment. Add yourself as a **required reviewer** of
that environment (Settings → Environments → `npm-publish`) to get an approval step between
starting the workflow and anything being published.

## If npm stages a version

npm may hold a newly accepted version as staged for a few minutes; publishing it again meanwhile
fails with `E409 … Cannot publish over previously staged version` (a brand-new package can also
show a `0.0.0-stage` placeholder). When that is the only failure, the publish step
(`scripts/publish-wait.mjs`) waits up to 15 minutes until `npm view <name>@<version>` shows each
staged version. If a version is still not shown, the job fails: approve it on npmjs.com (the
package's Staged Packages), or run `npm stage list <name>` and `npm stage approve <stage-id>`
(2FA), then run the workflow again.

A staged version may not be this run's code: an earlier run on an older `main`, or anyone else with
publish rights, may have staged it. So before going on, the step reads the SLSA provenance in npm's
attestations for each staged version and checks that it:

- describes that version (subject `pkg:npm/%40next-federation/<name>@<version>`);
- names this repository, with its source (`git+<repository>@<ref>`) in this repository;
- names this workflow, `.github/workflows/publish.yml`;
- names the commit the run is at (`git rev-parse HEAD`).

The version's `gitHead`, if npm has one, must name that commit too. Only then does the step publish
the rest, and `changeset publish` tags what it publishes at that commit. Otherwise the job fails,
publishing and tagging nothing more:

- **Another version, repository, workflow or commit.** The version npm approved is not shown to be
  this run's code. Inspect it (`npm pack <name>@<version>`). If it is not what you meant to
  release, deprecate it (`npm deprecate <name>@<version> "<reason>"`) and release a new version:
  npm never allows publishing a version again.
- **No provenance (or npm did not return it).** This workflow always publishes with provenance, so
  the version was staged some other way, such as a local `npm publish`. The run cannot tell which
  commit it came from. Compare `npm pack <name>@<version>` with a build of the commit by hand. If
  they match, tag it (`git tag <name>@<version> <commit>`, `git push origin <name>@<version>`) and
  run the workflow again, which skips the versions npm shows and publishes the rest.

`gitHead` alone is never enough. pnpm publishes a packed tarball, so npm records no `gitHead` for
this repository's versions (none of the 0.1.0 versions has one). And `gitHead` is whatever the
publisher's `package.json` says.

Known limit: the step checks npm's attestation as the registry serves it. It does not verify the
Sigstore bundle itself (the signature, or the source repository, commit and workflow that the
Fulcio certificate records), so it relies on the registry having checked the provenance when it
accepted the version. Treat the check as a guard against staging the wrong commit, not as proof:
if anything about a staged version is unexpected, review it by hand before tagging or releasing
more.

`changeset publish` tags only what it publishes itself, so a staged version gets no tag from the
workflow: once the check passes, tag it at the run's commit by hand as above.

## One-time setup

1. **Create the npm organization.** On npmjs.com create the `next-federation` organization (the scope
   is `@next-federation`). Enable two-factor authentication on the account.
2. **First publish with a token.** A trusted publisher can only be configured for a package that
   already exists, so the first release uses a token:
   - Create a granular access token that can publish to the `@next-federation` scope (read and
     write; allowed to publish without a 2FA prompt) or a classic automation token. Give it a short
     expiry.
   - Add it as the secret `NPM_TOKEN` of the `npm-publish` environment (Settings → Environments →
     `npm-publish` → Environment secrets), or as a repository secret. Never paste it anywhere else.
   - Merge the first "Version Packages" pull request, then run **Publish to npm** (dry run, then for
     real). It publishes all 8 packages with provenance.
3. **Configure a trusted publisher for each package.** For each of the 8 packages, on npmjs.com open
   the package, Settings, Trusted Publisher, choose GitHub Actions and enter: owner `tariqule`,
   repository `next-federation`, workflow filename `publish.yml`, environment `npm-publish`.
4. **Remove the token.** Delete the `NPM_TOKEN` secret and revoke the token on npm. From now on the
   publish workflow authenticates with GitHub's OIDC identity (`id-token: write`). It installs npm
   11.5.1 or newer, which trusted publishing requires.

Check the current npm documentation on trusted publishers if a step above has changed.

## Notes

- Provenance is on (`NPM_CONFIG_PROVENANCE: true`). It needs a public repository, and the
  `repository` field in each package's `package.json` must match this repository.
- Run `pnpm build && pnpm check:pack` locally, or the workflow's dry run, before publishing if you
  want to inspect the tarballs.
- The tag ruleset protects `@next-federation/*` and `v*` tags from deletion and rewrites; creating
  them is allowed, so the publish workflow can push them.
