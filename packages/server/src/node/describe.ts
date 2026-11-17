// `nf-describe`: turns any built Module Federation 2.0 remote (Rspack,
// webpack, Vite, ...) into a next-federation components (Mode A) build: the
// descriptor `nf-components.json` (sha384 of every server file, signed with
// NF_COMPONENTS_SIGNING_KEY when set) and `nf-build.json`, in nf-serve's
// layout. The same code as @next-federation/vite's nextFederationComponents.
import {
  access,
  lstat,
  readFile,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, join, posix, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  BUILD_ID_PATTERN,
  COMPONENTS_DESCRIPTOR_FILE,
  COMPONENTS_JWS_TYPE,
  assertSecureUrl,
  canonicalJson,
  componentDescriptorBytes,
  componentDescriptorDigest,
  parseComponentDescriptorFile,
  sha384Integrity,
} from '@next-federation/protocol'
import type {
  ComponentBuildDescriptor,
  ComponentDescriptorFile,
} from '@next-federation/protocol'
import { NFError, logger } from '@next-federation/sdk'
import { compactVerify, decodeProtectedHeader, importJWK } from 'jose'
import type { JWK } from 'jose'
import {
  assertBuildDir,
  assertBuildFile,
  collectBrowserAssets,
  collectServerIntegrity,
  TYPES_FOLDER,
  TYPES_INDEX_FILE,
  collectTypesIndex,
  typesIndexBytes,
  writeTypesIndex,
  createDescriptorFile,
  readSharedUsage,
  sharedFromManifest,
} from './components-descriptor.ts'
import type { ComponentsBuildInfo } from './components-descriptor.ts'

export type DescribeOptions = {
  /**
   * The build folder, named after its build id: the Module Federation output
   * (with `mf-manifest.json`) in `<dir>/client/`. nf-serve serves
   * `<dir>/client/` under `/b/<buildId>/`.
   */
  dir: string
  /**
   * The CommonJS server entry, relative to `client/` (e.g.
   * `server/remoteEntry.js`). Recorded in the manifest as `ssrRemoteEntry`
   * when the manifest names none (Rspack and webpack manifests never do).
   */
  ssrEntry?: string
  /** false: no server build, hosts render the build in the browser only. */
  ssr?: boolean
  /** The build's public URL. Default: the manifest's absolute `publicPath`. */
  base?: string
  /** Default: the folder name. */
  buildId?: string
  /** Accept a plain-http `base` for a non-loopback host (warned once). */
  allowInsecureHttp?: boolean
  /**
   * Index and sign the declarations in `client/@mf-types/` (hosts'
   * `nf-types`). Default false: a build's `@mf-types/` folder is left
   * unsigned, and hosts download no types. NF-002 when the folder is missing.
   */
  types?: boolean
  /** Reads NF_COMPONENTS_SIGNING_KEY (sign) and NODE_ENV. */
  env: Record<string, string | undefined>
  /** Build time (ms) of a build described the first time. Default: now. */
  now?: number
}

export type DescribedBuild = {
  file: ComponentDescriptorFile
  info: ComponentsBuildInfo
}

type Manifest = {
  name?: unknown
  metaData?: {
    name?: unknown
    publicPath?: unknown
    ssrRemoteEntry?: { name?: unknown; path?: unknown; type?: unknown }
  }
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
/** The only module a host's server loader resolves for a remote. */
const HOST_RUNTIME = '@module-federation/runtime'
/** `require("x")` of anything but a relative file. */
const BARE_REQUIRE = /require\(\s*["']([^"'.][^"']*)["']\s*\)/g

const invalid = (detail: string): NFError => new NFError('NF-002', detail)

async function readJson(file: string, what: string): Promise<unknown> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    throw invalid(`${what} not found: ${file}.`)
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw invalid(`${what} is not JSON: ${file}.`)
  }
}

/** `a/./b/` -> `a/b`, '' for the folder itself; null when it leaves it. */
function insideRelative(path: string): string | null {
  if (path.startsWith('/') || path.includes('\\')) return null
  let normal = posix.normalize(path === '' ? '.' : path)
  // Trailing slashes, without a regex (CodeQL js/polynomial-redos).
  while (normal.length > 1 && normal.endsWith('/')) normal = normal.slice(0, -1)
  if (normal === '..' || normal.startsWith('../')) return null
  return normal === '.' ? '' : normal
}

function resolveBase(
  manifest: Manifest,
  opts: DescribeOptions,
  buildId: string
): string {
  const publicPath = manifest.metaData?.publicPath
  const value = opts.base ?? publicPath
  let url: URL | null = null
  try {
    url = typeof value === 'string' ? new URL(value) : null
  } catch {
    url = null
  }
  if (
    !url ||
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.search ||
    url.hash
  ) {
    throw invalid(
      `The build's public URL must be absolute http(s) without query or hash, got ${JSON.stringify(value)}: build with an absolute \`output.publicPath\`, or pass --base.`
    )
  }
  const env = opts.env.NODE_ENV
  assertSecureUrl(url, 'base', {
    allowInsecureHttp: opts.allowInsecureHttp === true,
    development: env === 'development' || env === 'test',
  })
  const base = url.href.endsWith('/') ? url.href : `${url.href}/`
  if (!url.pathname.split('/').includes(buildId)) {
    throw invalid(
      `The public URL ${base} must be unique per build: it needs the build id "${buildId}" as a path segment (nf-serve serves builds under /b/<buildId>/).`
    )
  }
  if (
    typeof publicPath === 'string' &&
    /^https?:\/\//.test(publicPath) &&
    (publicPath.endsWith('/') ? publicPath : `${publicPath}/`) !== base
  ) {
    throw invalid(
      `--base ${base} is not the manifest's publicPath ${publicPath}: browsers would load the chunks from another URL.`
    )
  }
  return base
}

/**
 * The manifest's server entry, recorded from `ssrEntry` when it names none.
 * Returns false when the build has no server code.
 */
async function resolveServerEntry(
  client: string,
  manifest: Manifest,
  opts: DescribeOptions
): Promise<boolean> {
  if (opts.ssr === false) return false
  const existing = manifest.metaData?.ssrRemoteEntry
  const existingPath =
    typeof existing?.name === 'string'
      ? insideRelative(
          posix.join(
            typeof existing.path === 'string' ? existing.path : '',
            existing.name
          )
        )
      : null
  if (opts.ssrEntry === undefined) {
    if (existing === undefined) {
      throw invalid(
        'mf-manifest.json names no server entry (ssrRemoteEntry): pass --ssr-entry <path of the CommonJS server remoteEntry, relative to client/>, or --no-ssr for a browser-only build.'
      )
    }
    if (existingPath === null) {
      throw invalid(
        `mf-manifest.json names a server entry outside the build folder: ${JSON.stringify(existing)}.`
      )
    }
    return true
  }
  const entry = insideRelative(opts.ssrEntry)
  if (entry === null || entry === '') {
    throw invalid(
      `--ssr-entry must be a file inside client/, got ${JSON.stringify(opts.ssrEntry)}.`
    )
  }
  try {
    await access(join(client, entry))
  } catch {
    throw invalid(`The server entry ${entry} is not in ${client}.`)
  }
  if (existing !== undefined) {
    if (existingPath !== entry) {
      throw invalid(
        `mf-manifest.json already names another server entry, ${JSON.stringify(existingPath ?? existing)}, not ${entry}.`
      )
    }
    return true
  }
  const dir = posix.dirname(entry)
  const data = manifest as Manifest & { metaData: Record<string, unknown> }
  data.metaData.ssrRemoteEntry = {
    name: posix.basename(entry),
    path: dir === '.' ? '' : dir,
    type: 'commonjs-module',
  }
  await writeBuildFile(
    join(client, 'mf-manifest.json'),
    `${JSON.stringify(data, null, 2)}\n`
  )
  return true
}

/**
 * NF-002 when a server file requires anything a host never provides: the
 * host evaluates the server build with a `require` that resolves relative
 * files and @module-federation/runtime only.
 */
async function assertHostLoadable(
  client: string,
  integrity: Record<string, string>
): Promise<void> {
  for (const path of Object.keys(integrity)) {
    if (path === 'mf-manifest.json') continue
    const code = await readFile(join(client, path), 'utf8')
    const bare = new Set<string>()
    for (const match of code.matchAll(BARE_REQUIRE)) {
      if (match[1] !== HOST_RUNTIME) bare.add(match[1]!)
    }
    if (bare.size > 0) {
      const names = [...bare].map((n) => JSON.stringify(n)).join(', ')
      throw invalid(
        `${path} requires ${names}, which hosts never provide: they evaluate the server build with a require() that resolves only its own relative files and ${HOST_RUNTIME}. A webpack or Rspack server build loads async chunks with Node's fs and vm: build it as one file (output.asyncChunks: false and LimitChunkCountPlugin({ maxChunks: 1 })), and declare shared modules host-provided (import: false).`
      )
    }
  }
}

async function isSymlink(path: string): Promise<boolean | null> {
  try {
    return (await lstat(path)).isSymbolicLink()
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return null
    throw error
  }
}

/** NF-002 when `path` is a symlink: nf-describe never writes through one. */
async function assertNotSymlink(path: string): Promise<void> {
  if (await isSymlink(path)) {
    throw invalid(
      `${path} is a symlink: nf-describe never reads or writes a build file through one.`
    )
  }
}

/**
 * Replaces `path` with `text`: refuses a symlink, removes the old file, then
 * creates a new one exclusively (`wx`), so a symlink planted in between is
 * never followed.
 */
async function writeBuildFile(path: string, text: string): Promise<void> {
  const exists = await isSymlink(path)
  if (exists) await assertNotSymlink(path)
  if (exists !== null) await unlink(path)
  await writeFile(path, text, { flag: 'wx' })
}

/** NF-002 unless `client/` is a real directory inside the build folder. */
async function assertClientDir(dir: string, client: string): Promise<string> {
  let realDir: string
  try {
    realDir = await realpath(dir)
    await lstat(client)
  } catch {
    throw invalid(`The build folder has no client/ folder: ${client}.`)
  }
  await assertBuildDir(client, realDir, 'client/')
  return realpath(client)
}

async function previousBuiltAt(
  dir: string,
  buildId: string
): Promise<number | undefined> {
  const path = join(dir, 'nf-build.json')
  if ((await isSymlink(path)) !== false) return undefined
  try {
    const info = JSON.parse(
      await readFile(path, 'utf8')
    ) as Partial<ComponentsBuildInfo>
    return info.buildId === buildId && typeof info.builtAt === 'number'
      ? info.builtAt
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Describes one built remote: validates the manifest, records the server
 * entry, hashes the server graph, collects the browser assets, writes
 * `nf-components.json` and, last, `nf-build.json` (nf-serve only serves a
 * folder that has it). Re-describing a build keeps its build time. Never
 * reads or writes a build file through a symlink.
 */
export async function describeComponentsBuild(
  opts: DescribeOptions
): Promise<DescribedBuild> {
  const dir = resolve(opts.dir)
  const client = join(dir, 'client')
  const buildId = opts.buildId ?? basename(dir)
  if (!BUILD_ID_PATTERN.test(buildId)) {
    throw invalid(
      `The build id must match ${BUILD_ID_PATTERN}, got ${JSON.stringify(buildId)} (the build folder's name, or --build-id).`
    )
  }
  const descriptorPath = join(dir, COMPONENTS_DESCRIPTOR_FILE)
  const infoPath = join(dir, 'nf-build.json')
  const manifestPath = join(client, 'mf-manifest.json')
  // Before anything is written.
  await assertClientDir(dir, client)
  for (const path of [manifestPath, descriptorPath, infoPath]) {
    await assertNotSymlink(path)
  }
  const raw = await readJson(manifestPath, 'mf-manifest.json')
  if (typeof raw !== 'object' || raw === null) {
    throw invalid('mf-manifest.json must be a JSON object.')
  }
  const manifest = raw as Manifest
  manifest.metaData ??= {}
  const name = manifest.metaData.name ?? manifest.name
  if (typeof name !== 'string' || !IDENTIFIER.test(name)) {
    throw invalid(
      `The container name ${JSON.stringify(name)} must match ${IDENTIFIER}.`
    )
  }
  const base = resolveBase(manifest, opts, buildId)
  const ssr = await resolveServerEntry(client, manifest, opts)
  let integrity: Record<string, string> | null = null
  if (ssr) {
    integrity = await collectServerIntegrity(client)
    await assertHostLoadable(client, integrity)
  }
  const builtAt =
    (await previousBuiltAt(dir, buildId)) ?? opts.now ?? Date.now()
  const payload: ComponentBuildDescriptor = {
    v: 1,
    name,
    buildId,
    base,
    manifest: `${base}mf-manifest.json`,
    ssr: integrity ? { integrity } : null,
    iat: Math.floor(builtAt / 1000),
    // As the Vite plugin: the only stylesheet and modulepreload URLs hosts render.
    assets: await collectBrowserAssets(client, base),
  }
  // What the host's shared modules must satisfy (NF-036), from the manifest;
  // per expose only with the Vite plugin's usage file.
  const shared = sharedFromManifest(manifest, await readSharedUsage(dir))
  if (shared) payload.shared = shared
  // The exposed modules' declarations index: opt-in, as the Vite plugin's
  // `types` (an `@mf-types/` folder alone publishes nothing).
  if (opts.types === true) {
    const types = await writeTypesIndex(client, base)
    if (!types) {
      throw invalid(
        `--types: the build has no client/${TYPES_FOLDER}/ folder of declarations to sign.`
      )
    }
    payload.types = types
  }
  const file = await createDescriptorFile(payload, opts.env)
  const info: ComponentsBuildInfo = {
    kind: 'components',
    name,
    buildId,
    builtAt,
    base,
  }
  await writeBuildFile(descriptorPath, `${JSON.stringify(file, null, 2)}\n`)
  await writeBuildFile(infoPath, `${JSON.stringify(info, null, 2)}\n`)
  return { file, info }
}

const mismatch = (detail: string): NFError => new NFError('NF-027', detail)

export type VerifyOptions = {
  /** Public JWKs: verify the descriptor's ES256 signature with one of them. */
  publicKeys?: JWK[]
}

export type VerifyResult = {
  /** `not-checked`: signed, but no public key was given. */
  signature: 'verified' | 'not-checked' | 'unsigned'
}

const b64url = (text: string): Uint8Array =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0)
  )

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, i) => byte === b[i])

/** True when one of `keys` verifies `jws` (ES256, `nf-components+jws`), as hosts check it. */
async function signatureVerifies(jws: string, keys: JWK[]): Promise<boolean> {
  let kid: string | undefined
  try {
    const header = decodeProtectedHeader(jws)
    if (header.alg !== 'ES256' || header.typ !== COMPONENTS_JWS_TYPE) {
      return false
    }
    kid = header.kid
  } catch {
    return false
  }
  for (const key of keys) {
    if (key.kid !== undefined && kid !== undefined && key.kid !== kid) continue
    try {
      await compactVerify(jws, await importJWK({ ...key }, 'ES256'), {
        algorithms: ['ES256'],
      })
      return true
    } catch {
      // Try the next key.
    }
  }
  return false
}

/**
 * Checks a described build on disk before it ships (NF-027 otherwise):
 * - the digest is the digest of the canonical payload (assets included);
 * - a JWS's payload is exactly that canonical payload, and, with
 *   `publicKeys`, its ES256 signature verifies (without them the signature
 *   is not checked, and the result says so);
 * - the assets and the shared modules are the ones `mf-manifest.json` lists;
 * - a signed types index is `client/@mf-types/index.json` and lists exactly
 *   the declaration files there (a folder the descriptor does not sign, as
 *   in a build described without `--types`, is not checked);
 * - every server file still has its recorded sha384, and the server graph has
 *   no file the descriptor does not list.
 */
export async function verifyComponentsBuild(
  dir: string,
  options: VerifyOptions = {}
): Promise<VerifyResult> {
  const root = resolve(dir)
  const client = join(root, 'client')
  const descriptorPath = join(root, COMPONENTS_DESCRIPTOR_FILE)
  await assertNotSymlink(descriptorPath)
  // Every check below reads client/ (the assets read its manifest even
  // for a browser-only build): never through a symlink.
  const realClient = await assertClientDir(root, client)
  await assertBuildFile(
    join(client, 'mf-manifest.json'),
    realClient,
    'client/mf-manifest.json'
  )
  const file = parseComponentDescriptorFile(
    await readJson(descriptorPath, COMPONENTS_DESCRIPTOR_FILE)
  )
  if (!file) {
    throw mismatch(`${COMPONENTS_DESCRIPTOR_FILE} is not a valid descriptor.`)
  }
  if ((await componentDescriptorDigest(file)) !== file.digest) {
    throw mismatch(
      `The payload of ${COMPONENTS_DESCRIPTOR_FILE} does not match its digest: it was edited after it was written.`
    )
  }
  let signature: VerifyResult['signature'] = 'unsigned'
  if (file.jws !== undefined) {
    const parts = file.jws.split('.')
    let signed: Uint8Array | null = null
    try {
      signed = parts.length === 3 ? b64url(parts[1]!) : null
    } catch {
      signed = null
    }
    if (!signed || !sameBytes(signed, componentDescriptorBytes(file))) {
      throw mismatch(
        `The JWS of ${COMPONENTS_DESCRIPTOR_FILE} signs another payload than the descriptor's: it was edited after it was signed.`
      )
    }
    signature = 'not-checked'
    if (options.publicKeys && options.publicKeys.length > 0) {
      if (!(await signatureVerifies(file.jws, options.publicKeys))) {
        throw mismatch(
          `The signature of ${COMPONENTS_DESCRIPTOR_FILE} does not verify with the given public key(s).`
        )
      }
      signature = 'verified'
    }
  } else if (options.publicKeys && options.publicKeys.length > 0) {
    throw mismatch(
      `${COMPONENTS_DESCRIPTOR_FILE} is unsigned, but a public key was given.`
    )
  }
  if (file.assets !== undefined) {
    const assets = await collectBrowserAssets(client, file.base)
    if (canonicalJson(assets) !== canonicalJson(file.assets)) {
      throw mismatch(
        `The assets in ${COMPONENTS_DESCRIPTOR_FILE} are not the ones mf-manifest.json lists.`
      )
    }
  }
  const shared = sharedFromManifest(
    await readJson(join(client, 'mf-manifest.json'), 'mf-manifest.json'),
    await readSharedUsage(root)
  )
  if (canonicalJson(shared ?? null) !== canonicalJson(file.shared ?? null)) {
    throw mismatch(
      `The shared modules in ${COMPONENTS_DESCRIPTOR_FILE} are not the ones mf-manifest.json lists.`
    )
  }
  await verifyTypes(client, realClient, file)
  if (!file.ssr) return { signature }
  const graph = await collectServerIntegrity(client)
  for (const [path, expected] of Object.entries(file.ssr.integrity)) {
    let actual = graph[path]
    if (actual === undefined) {
      try {
        await assertBuildFile(join(client, path), realClient, path)
        actual = await sha384Integrity(await readFile(join(client, path)))
      } catch (error) {
        if ((error as { code?: unknown }).code === 'NF-002') throw error
        throw mismatch(`${path} is listed in the descriptor but missing.`)
      }
    }
    if (actual !== expected) {
      throw mismatch(
        `${path} does not match its sha384 in ${COMPONENTS_DESCRIPTOR_FILE} (expected ${expected}, got ${actual}).`
      )
    }
  }
  const unlisted = Object.keys(graph).filter((p) => !(p in file.ssr!.integrity))
  if (unlisted.length > 0) {
    throw mismatch(
      `The server graph has files the descriptor does not list: ${unlisted.join(', ')}.`
    )
  }
  return { signature }
}

/**
 * The signed index is the one on disk, and lists exactly the files there.
 * Nothing to check when the descriptor signs no types: hosts download only
 * signed declarations, so an unsigned `@mf-types/` folder is never published.
 */
async function verifyTypes(
  client: string,
  realClient: string,
  file: ComponentDescriptorFile
): Promise<void> {
  if (!file.types) return
  const index = await collectTypesIndex(client)
  const path = `${TYPES_FOLDER}/${TYPES_INDEX_FILE}`
  if (!index || file.types.index !== `${file.base}${path}`) {
    throw mismatch(
      `The types index in ${COMPONENTS_DESCRIPTOR_FILE} is not client/${path}.`
    )
  }
  await assertBuildFile(join(client, path), realClient, path)
  const bytes = await readFile(join(client, path))
  if ((await sha384Integrity(bytes)) !== file.types.integrity) {
    throw mismatch(
      `client/${path} does not match its sha384 in ${COMPONENTS_DESCRIPTOR_FILE}.`
    )
  }
  if (!sameBytes(new Uint8Array(bytes), typesIndexBytes(index))) {
    throw mismatch(
      `client/${path} is not the declarations in client/${TYPES_FOLDER}/ (a file was edited, added or removed).`
    )
  }
}

const USAGE =
  'usage: nf-describe --dir <build folder> (--ssr-entry <path in client/> | --no-ssr) [--base <url>] [--build-id <id>] [--types] [--allow-insecure-http]\n       nf-describe --dir <build folder> --verify [--public-key <JWK JSON | JWK file>]...\n(NF_COMPONENTS_SIGNING_KEY: a private EC P-256 JWK signs the descriptor)'

async function readPublicKey(value: string): Promise<JWK> {
  const text = value.trim().startsWith('{')
    ? value
    : await readFile(value, 'utf8').catch(() => {
        throw invalid(
          `--public-key ${value}: not a JWK and not a readable file.`
        )
      })
  try {
    const jwk = JSON.parse(text) as JWK
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || 'd' in jwk) throw 0
    return jwk
  } catch {
    throw invalid(
      '--public-key must be a public EC P-256 JWK (JSON, without "d"), or a file holding one.'
    )
  }
}

/** One output line: `warn` for what needs attention, `info` otherwise. */
export type DescribeLog = (line: string, level?: 'info' | 'warn') => void

const defaultLog: DescribeLog = (line, level = 'info') => {
  if (level === 'warn') logger.warn('NF-028', line)
  else logger.info(line)
}

/** The `nf-describe` command: 0 on success, 1 on failure (printed with `log`). */
export async function runDescribeCli(
  argv: string[],
  env: Record<string, string | undefined>,
  log: DescribeLog = defaultLog
): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        dir: { type: 'string' },
        'ssr-entry': { type: 'string' },
        'no-ssr': { type: 'boolean' },
        base: { type: 'string' },
        'build-id': { type: 'string' },
        'allow-insecure-http': { type: 'boolean' },
        types: { type: 'boolean' },
        verify: { type: 'boolean' },
        'public-key': { type: 'string', multiple: true },
      },
    })
    const dir = values.dir ?? positionals[0]
    if (!dir) throw new Error(USAGE)
    if (values.verify) {
      const publicKeys = await Promise.all(
        (values['public-key'] ?? []).map(readPublicKey)
      )
      const { signature } = await verifyComponentsBuild(dir, { publicKeys })
      const note =
        signature === 'verified'
          ? 'signature verified'
          : signature === 'not-checked'
            ? 'signature not checked (pass --public-key to check it)'
            : 'unsigned'
      log(
        `${dir}: the descriptor and every server file match (${note}).`,
        signature === 'not-checked' ? 'warn' : 'info'
      )
      return 0
    }
    const { file } = await describeComponentsBuild({
      dir,
      ssrEntry: values['ssr-entry'],
      ssr: values['no-ssr'] ? false : undefined,
      base: values.base,
      buildId: values['build-id'],
      allowInsecureHttp: values['allow-insecure-http'],
      types: values.types,
      env,
    })
    const files = file.ssr ? Object.keys(file.ssr.integrity).length : 0
    const line = `${file.name} build ${file.buildId} described (${file.jws ? 'signed' : 'unsigned'}; ${file.ssr ? `${files} server files hashed` : 'browser only'}): ${join(dir, COMPONENTS_DESCRIPTOR_FILE)}`
    if (!file.jws && env.NODE_ENV === 'production') {
      log(
        `${line}. Unsigned in a production build: hosts render it in the browser only unless they pin its digest (set NF_COMPONENTS_SIGNING_KEY to sign it).`,
        'warn'
      )
    } else {
      log(line)
    }
    return 0
  } catch (error) {
    log(error instanceof Error ? error.message : String(error))
    return 1
  }
}
