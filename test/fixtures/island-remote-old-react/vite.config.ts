// Task 18A: the island-remote fixture (root `../island-remote`, its sources
// and plugins) built against the previous React 19 patch, as remote `c` on
// port 4104. `react`, `react-dom` and `react-server-dom-webpack` resolve from
// this folder's own node_modules (ruling 7). Outside the pnpm workspace:
// install with `pnpm install --ignore-workspace` in this folder.
import { islandRemoteConfig } from '../island-remote/vite.config.ts'

const HERE = import.meta.dirname

export default islandRemoteConfig({
  reactFrom: HERE,
  outDir: `${HERE}/dist/${process.env.NF_REMOTE ?? 'c'}`,
})
