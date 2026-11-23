# Pull request labels

`.github/labeler.yml` applies these labels by the paths a pull request changes. Create them once,
with the gh CLI signed in as a maintainer (`--force` updates a label that already exists):

```sh
gh label create 'pkg:sdk'      --repo tariqule/next-federation --force --color 1D76DB --description 'Changes @next-federation/sdk'
gh label create 'pkg:protocol' --repo tariqule/next-federation --force --color 1D76DB --description 'Changes @next-federation/protocol'
gh label create 'pkg:core'     --repo tariqule/next-federation --force --color 1D76DB --description 'Changes @next-federation/core'
gh label create 'pkg:react'    --repo tariqule/next-federation --force --color 1D76DB --description 'Changes @next-federation/react'
gh label create 'pkg:island'   --repo tariqule/next-federation --force --color 1D76DB --description 'Changes @next-federation/island'
gh label create 'pkg:server'   --repo tariqule/next-federation --force --color 1D76DB --description 'Changes @next-federation/server'
gh label create 'pkg:router'   --repo tariqule/next-federation --force --color 1D76DB --description 'Changes @next-federation/router'
gh label create 'pkg:vite'     --repo tariqule/next-federation --force --color 1D76DB --description 'Changes @next-federation/vite'
gh label create 'pkg:next'     --repo tariqule/next-federation --force --color 1D76DB --description 'Changes @next-federation/next'
gh label create 'docs'         --repo tariqule/next-federation --force --color 0075CA --description 'Documentation and Markdown files'
gh label create 'examples'     --repo tariqule/next-federation --force --color 0E8A16 --description 'Example apps'
gh label create 'ci'           --repo tariqule/next-federation --force --color 5319E7 --description 'Workflows, GitHub config and repository scripts'
gh label create 'tests'        --repo tariqule/next-federation --force --color FBCA04 --description 'Unit tests, fixtures and e2e'
gh label create 'deps'         --repo tariqule/next-federation --force --color 6F42C1 --description 'Root package.json, lockfile and workspace config'
```

| Label                                                                              | Colour   | Paths                                                      |
| ---------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------- |
| `pkg:sdk`, `pkg:protocol`, `pkg:core`, `pkg:react`, `pkg:island`, `pkg:server`, `pkg:router`, `pkg:vite`, `pkg:next` | `1D76DB` | `packages/<name>/**`                                       |
| `docs`                                                                             | `0075CA` | `docs/**`, `**/*.md`, `docs-site/**`                       |
| `examples`                                                                         | `0E8A16` | `examples/**`                                              |
| `ci`                                                                               | `5319E7` | `.github/**`, `scripts/**`                                 |
| `tests`                                                                            | `FBCA04` | `test/**`, `packages/*/__tests__/**`                       |
| `deps`                                                                             | `6F42C1` | `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`    |

The labeler only adds labels that exist in the repository, and it runs from the config on `main`, so
a change to `labeler.yml` takes effect once it is merged.
