// The island-remote fixture (root `../island-remote`, its sources
// and plugins) built against an older React 19 (19.2.9), as remote `c` on
// port 4104. `react`, `react-dom` and `react-server-dom-webpack` resolve from
// this folder's own node_modules. Outside the pnpm workspace:
// install with `pnpm install --ignore-workspace` in this folder.
import { islandRemoteConfig } from '../island-remote/vite.config.ts'

const HERE = import.meta.dirname

export default islandRemoteConfig({
  reactFrom: HERE,
  outDir: `${HERE}/dist/${process.env.NF_REMOTE ?? 'c'}`,
})
