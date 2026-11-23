// `@next-federation/router/build`: what a remote build puts in its config.
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from '@rstest/core'
import {
  reactRouterDirectory,
  routerEntryFile,
  routerSharedEntry,
  routerShimAliases,
} from '../src/build.ts'

const pkgDir = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
  version: string
}

/** The `.` export's file, relative to the package. */
const exportsDot = () =>
  (
    JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
      exports: { '.': { default: string } }
    }
  ).exports['.'].default

const temps: string[] = []
afterEach(() => {
  for (const dir of temps.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe('routerShimAliases', () => {
  it('aliases are exact and absolute', () => {
    const aliases = routerShimAliases()
    expect(Object.keys(aliases).sort()).toEqual([
      '@next-federation/router$',
      'next/link$',
      'next/navigation$',
    ])
    // The router itself: this install's own entry (what routerSharedEntry's
    // `import` name resolves to).
    expect(aliases['@next-federation/router$']).toBe(routerEntryFile())
    expect(routerEntryFile()).toBe(join(pkgDir, exportsDot()))
    for (const [key, file] of Object.entries(aliases)) {
      expect(isAbsolute(file)).toBe(true)
      if (key === '@next-federation/router$') continue
      expect(existsSync(file)).toBe(true)
      // This install's own shims.
      expect(file.startsWith(join(pkgDir, 'src', 'shims'))).toBe(true)
    }
    expect(aliases['next/link$']).toMatch(/shims[\\/]next-link\.tsx$/)
    expect(aliases['next/navigation$']).toMatch(
      /shims[\\/]next-navigation\.ts$/
    )

    const withRouter = routerShimAliases({ reactRouter: true, root: pkgDir })
    expect(Object.keys(withRouter).sort()).toEqual([
      '@next-federation/router$',
      '@next-federation/router/real-react-router$',
      'next/link$',
      'next/navigation$',
      'react-router$',
      'react-router-dom$',
    ])
    expect(withRouter['react-router$']).toMatch(/shims[\\/]react-router\.tsx$/)
    expect(withRouter['react-router-dom$']).toBe(withRouter['react-router$'])
    // The real package: the react-router directory the root resolves.
    expect(withRouter['@next-federation/router/real-react-router$']).toBe(
      realpathSync(join(pkgDir, 'node_modules', 'react-router'))
    )
    for (const file of Object.values(withRouter)) {
      expect(isAbsolute(file)).toBe(true)
    }
  })

  it('reactRouter without react-router at the root throws; reactRouterDirectory is null there', () => {
    const root = mkdtempSync(join(tmpdir(), 'nf-router-build-'))
    temps.push(root)
    writeFileSync(join(root, 'package.json'), '{"name":"app"}')
    // The test runner's NODE_PATH (pnpm's hoisted store, which holds
    // react-router) does not count: only node_modules folders do.
    expect(process.env.NODE_PATH ?? '').toContain('node_modules')
    expect(reactRouterDirectory(root)).toBeNull()
    expect(() => routerShimAliases({ reactRouter: true, root })).toThrow(
      /react-router installed/
    )
    // Installed there: found, the package's own directory.
    const dir = join(root, 'node_modules', 'react-router')
    mkdirSync(join(dir, 'dist'), { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'react-router', main: './dist/index.js' })
    )
    writeFileSync(join(dir, 'dist', 'index.js'), 'module.exports = {}\n')
    expect(reactRouterDirectory(root)).toBe(realpathSync(dir))
    expect(dirname(reactRouterDirectory(root)!)).toBe(
      realpathSync(join(root, 'node_modules'))
    )
  })
})

describe('routerSharedEntry', () => {
  it('routerSharedEntry range is >=<major.minor>.0 <1.0.0 on 0.x; import is the package name, never a path', () => {
    const [major, minor] = pkg.version.split('.')
    expect(major).toBe('0')
    expect(routerSharedEntry()).toEqual({
      '@next-federation/router': {
        singleton: false,
        version: pkg.version,
        requiredVersion: `>=0.${minor}.0 <1.0.0`,
        import: '@next-federation/router',
      },
    })
  })

  // Rspack and the built router (needs `pnpm build`): a project inside the
  // Rspack fixture's node_modules (so @rspack/core and react resolve), with
  // a router planted in a parent node_modules of the project.
  it('an Rspack build with routerSharedEntry() never bundles a router planted in a parent node_modules', () => {
    const fixture = resolve(
      import.meta.dirname,
      '../../../test/fixtures/components-remote-rspack'
    )
    const parent = mkdtempSync(
      join(fixture, 'node_modules', '.nf-router-spec-')
    )
    temps.push(parent)
    const planted = join(parent, 'node_modules', '@next-federation', 'router')
    mkdirSync(join(planted, 'dist'), { recursive: true })
    writeFileSync(
      join(planted, 'package.json'),
      JSON.stringify({
        name: '@next-federation/router',
        version: pkg.version,
        type: 'module',
        exports: { '.': './dist/index.js', './package.json': './package.json' },
      })
    )
    writeFileSync(
      join(planted, 'dist', 'index.js'),
      [
        "const planted = 'PLANTED_ROUTER_MARKER'",
        'export const Link = () => planted',
        'export const useNavigate = () => () => planted',
        'export const usePathname = () => planted',
        'export const useSearchParams = () => planted',
      ].join('\n')
    )
    const app = join(parent, 'app')
    mkdirSync(join(app, 'src'), { recursive: true })
    writeFileSync(join(app, 'package.json'), '{"name":"app","type":"module"}')
    writeFileSync(
      join(app, 'src', 'Nav.js'),
      [
        "import Link from 'next/link'",
        // A direct import too: resolved from the project, it would find the
        // planted copy first.
        "import { usePathname } from '@next-federation/router'",
        "import { createElement } from 'react'",
        "export default () => createElement(Link, { href: '/x' }, usePathname())",
      ].join('\n')
    )
    const built = join(pkgDir, 'dist', 'build.js')
    writeFileSync(
      join(app, 'build.mjs'),
      [
        "import { rspack } from '@rspack/core'",
        "import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack'",
        `import { routerSharedEntry, routerShimAliases } from ${JSON.stringify(built)}`,
        "const hostProvided = { singleton: true, import: false, requiredVersion: '^19.0.0' }",
        'rspack({',
        "  mode: 'production', context: import.meta.dirname, entry: {}, target: 'web', devtool: false,",
        '  resolve: { alias: routerShimAliases() },',
        "  output: { path: import.meta.dirname + '/out', publicPath: 'http://127.0.0.1:4999/', uniqueName: 'spec' },",
        "  plugins: [new ModuleFederationPlugin({ name: 'spec', filename: 'remoteEntry.js', exposes: { './Nav': './src/Nav.js' },",
        "    shared: { react: hostProvided, 'react/jsx-runtime': hostProvided, ...routerSharedEntry() }, dts: false })],",
        '}, (err, stats) => {',
        '  if (err || stats.hasErrors()) { console.error(err ?? stats.toString({ all: false, errors: true })); process.exit(1) }',
        '})',
      ].join('\n')
    )
    execFileSync(process.execPath, [join(app, 'build.mjs')], {
      cwd: app,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    const js = readdirSync(join(app, 'out'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(join(app, 'out', f), 'utf8'))
      .join('\n')
    expect(js).not.toContain('PLANTED_ROUTER_MARKER')
    // This install's router is the bundled copy.
    expect(js).toContain('currententrychange')
  }, 120_000)

  // A remote's remoteEntry.js is published: it must not name a folder of
  // the machine that built it (the consumes map carries each `import`).
  it('an Rspack build (browser and server) with the helpers publishes no build-machine path', () => {
    const fixture = resolve(
      import.meta.dirname,
      '../../../test/fixtures/components-remote-rspack'
    )
    const app = mkdtempSync(join(fixture, 'node_modules', '.nf-router-paths-'))
    temps.push(app)
    mkdirSync(join(app, 'src'))
    writeFileSync(join(app, 'package.json'), '{"name":"app","type":"module"}')
    writeFileSync(
      join(app, 'src', 'Nav.js'),
      [
        "import Link from 'next/link'",
        "import { usePathname } from 'next/navigation'",
        "import { createElement } from 'react'",
        "export default () => createElement(Link, { href: '/x' }, usePathname())",
      ].join('\n')
    )
    const built = join(pkgDir, 'dist', 'build.js')
    writeFileSync(
      join(app, 'build.mjs'),
      [
        "import { rspack } from '@rspack/core'",
        "import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack'",
        `import { routerSharedEntry, routerShimAliases } from ${JSON.stringify(built)}`,
        "const hostProvided = { singleton: true, import: false, requiredVersion: '^19.0.0' }",
        "const shared = { react: hostProvided, 'react/jsx-runtime': hostProvided, ...routerSharedEntry() }",
        "const common = { mode: 'production', context: import.meta.dirname, entry: {}, devtool: false, resolve: { alias: routerShimAliases() } }",
        'const mf = (type) => new ModuleFederationPlugin({ name: "spec", filename: "remoteEntry.js", library: { type }, exposes: { "./Nav": "./src/Nav.js" }, shared, manifest: true, dts: false })',
        'rspack([',
        "  { ...common, name: 'browser', target: 'web', output: { path: import.meta.dirname + '/out/client', publicPath: 'http://127.0.0.1:4999/', uniqueName: 'spec', module: true, chunkFormat: 'module', chunkLoading: 'import' }, plugins: [mf('module')] },",
        "  { ...common, name: 'server', target: 'async-node', output: { path: import.meta.dirname + '/out/client/server', publicPath: 'http://127.0.0.1:4999/server/', uniqueName: 'spec', asyncChunks: false }, plugins: [mf('commonjs-module')] },",
        '], (err, stats) => {',
        '  if (err || stats.hasErrors()) { console.error(err ?? stats.toString({ all: false, errors: true })); process.exit(1) }',
        '})',
      ].join('\n')
    )
    execFileSync(process.execPath, [join(app, 'build.mjs')], {
      cwd: app,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    const repoRoot = resolve(pkgDir, '../..')
    for (const entry of [
      join(app, 'out', 'client', 'remoteEntry.js'),
      join(app, 'out', 'client', 'server', 'remoteEntry.js'),
    ]) {
      const js = readFileSync(entry, 'utf8')
      // Bundled: the shared router is in the build (it is not a path).
      expect(js).toContain('@next-federation/router')
      for (const machinePath of ['/Users/', '/home/', 'C:\\', repoRoot]) {
        expect({ entry, machinePath, has: js.includes(machinePath) }).toEqual({
          entry,
          machinePath,
          has: false,
        })
      }
    }
  }, 120_000)
})
