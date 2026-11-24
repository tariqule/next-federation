# NF-041: Installed `react-server-dom-webpack` has a known security advisory

## Why This Error Occurred

An island remote renders islands and runs Server Actions with `react-server-dom-webpack`. The installed version is affected by [GHSA-xqc2-xf4c-x3h3](https://github.com/advisories/GHSA-xqc2-xf4c-x3h3), unauthenticated remote code execution, or is a canary or experimental build that cannot be checked. Patched: **19.0.9**, **19.1.10**, **19.2.9**, **19.3.1**.

## Possible Ways to Fix It

- Upgrade `react`, `react-dom` and `react-server-dom-webpack` together, to one exact patched version, and remove any override that pins an affected one:

  ```sh
  npm install --save-exact react@19.3.1 react-dom@19.3.1 react-server-dom-webpack@19.3.1
  ```

- Then delete every build made with an affected version, because earlier builds keep running.
- `nf-serve`: delete those build folders from `--dir` and restart. If unsure which they are, restart with `--max-builds 1 --min-age-hours 0`.
- Vercel: delete the affected deployments (`vercel remove <deployment-url>`). With Skew Protection, old deployments stay reachable until deleted.
- Elsewhere: delete every deployment running an affected build.

## Useful Links

- [Writing an island remote](../guides/writing-an-island-remote.mdx)
- [Self-hosted build retention](../guides/self-hosted-skew.mdx)
