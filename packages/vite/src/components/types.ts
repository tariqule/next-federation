// The type declarations of a components remote's exposed modules, for hosts
// (`nf-types` downloads them; nothing runs them). Emitted with the remote's
// own TypeScript compiler API, not @module-federation/vite's `dts` (which
// forks tsc, zips the result and runs a type server in dev): plain files in
// Module Federation's `@mf-types/` layout, inside the immutable build folder,
// listed with their sha384 in `@mf-types/index.json`, which the descriptor
// signs (`writeTypesIndex`).
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { NFError, logger } from '@next-federation/sdk'
import { TYPES_FOLDER } from '@next-federation/server/node'
import type * as TS from 'typescript'

export type TypeScriptApi = typeof TS

/** The `typescript` package installed in the remote project; null without one. */
export function loadTypeScript(root: string): TypeScriptApi | null {
  try {
    return createRequire(join(resolve(root), 'package.json'))(
      'typescript'
    ) as TypeScriptApi
  } catch {
    return null
  }
}

export type EmitTypesOptions = {
  /** The Vite root (its tsconfig.json is used when there is one). */
  root: string
  /** Expose key -> source file, relative to `root`. */
  exposes: Record<string, string>
  /** The build's `client/` folder: declarations go to `client/@mf-types/`. */
  clientDir: string
  /** Where a skipped file is reported. Default: the next-federation logger. */
  warn?: (line: string) => void
}

const COMPILED = 'compiled-types'
// `import './Counter.css'` (kept in declarations): a host has no such file,
// and the import carries no types. Imports of code modules stay.
const ASSET_IMPORT =
  /^import\s+(['"])[^'"\n]+\.(?!(?:[cm]?[jt]sx?)\1)[A-Za-z0-9]+\1;?[ \t]*\r?\n?/gm

const toPosix = (path: string): string => path.split(sep).join('/')

/** Inside the remote's root and not in a node_modules folder. */
function insideRoot(root: string, file: string): boolean {
  const rel = relative(root, file)
  return (
    rel !== '' &&
    !rel.startsWith('..') &&
    !isAbsolute(rel) &&
    !rel.split(sep).includes('node_modules')
  )
}

/**
 * Writes `@mf-types/compiled-types/**` (declarations of the exposed modules
 * and the local files they import) and, per expose, `@mf-types/<Name>.d.ts`
 * re-exporting its module (and its default export, when it has one). NF-002
 * when TypeScript cannot emit them (a syntax or declaration error): a build
 * never publishes partial types.
 */
export async function emitExposeTypes(
  ts: TypeScriptApi,
  options: EmitTypesOptions
): Promise<void> {
  const root = resolve(options.root)
  const typesDir = join(resolve(options.clientDir), TYPES_FOLDER)
  const outDir = join(typesDir, COMPILED)
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json')
  let compilerOptions: TS.CompilerOptions = {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: true,
  }
  if (configPath && dirname(configPath) === root) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile)
    if (config.error) throw failure(ts, [config.error])
    compilerOptions = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      root
    ).options
  }
  const sources = Object.fromEntries(
    Object.entries(options.exposes).map(([key, file]) => [
      key,
      resolve(root, file),
    ])
  )
  const program = ts.createProgram(Object.values(sources), {
    ...compilerOptions,
    noEmit: false,
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: false,
    sourceMap: false,
    inlineSourceMap: false,
    composite: false,
    incremental: false,
    tsBuildInfoFile: undefined,
    noEmitOnError: false,
    // Declarations are published: never the source's comments (`/*!` ones,
    // which this keeps, are stripped after emit), and paths relative to the
    // remote's root (a specifier that leaves it is refused after emit).
    // Literal values are published as written.
    removeComments: true,
    rootDir: root,
    outDir,
    declarationDir: undefined,
    outFile: undefined,
  })
  const syntax = program.getSyntacticDiagnostics()
  if (syntax.length > 0) throw failure(ts, syntax)
  // Declaration files by source file, written only once every one emitted.
  const outputs = new Map<string, string>()
  const declarationOf = new Map<string, string>()
  const skipped: string[] = []
  const result = program.emit(
    undefined,
    (fileName, text, _bom, _onError, sourceFiles) => {
      const from = (sourceFiles ?? []).map((f) => resolve(f.fileName))
      const rel = relative(outDir, fileName)
      if (
        from.some((f) => !insideRoot(root, f)) ||
        rel.startsWith('..') ||
        isAbsolute(rel)
      ) {
        skipped.push(...(from.length > 0 ? from : [fileName]))
        return
      }
      if (!fileName.endsWith('.d.ts')) return
      outputs.set(
        fileName,
        stripComments(ts, fileName, text.replace(ASSET_IMPORT, ''))
      )
      for (const source of from) declarationOf.set(source, fileName)
    },
    undefined,
    true
  )
  // Files outside the root are skipped (TS6059 only says so).
  const errors = [
    ...result.diagnostics,
    ...program.getOptionsDiagnostics(),
  ].filter((d) => d.category === ts.DiagnosticCategory.Error && d.code !== 6059)
  if (skipped.length > 0) {
    const warn = options.warn ?? ((line: string) => logger.warn('NF-002', line))
    warn(
      `Declaration files not emitted (outside ${toPosix(root)} or in node_modules): ${[...new Set(skipped)].map(toPosix).join(', ')}. Literal values the published declarations take from them are still published.`
    )
  }
  if (errors.length > 0 || result.emitSkipped) throw failure(ts, errors)
  for (const [fileName, text] of outputs) {
    assertSpecifiersInside(ts, fileName, text, outDir, options.clientDir)
    // removeComments keeps `/*!` comments; they were stripped above, and a
    // file with any comment left publishes nothing.
    if (commentRanges(ts, fileName, text).length > 0) {
      throw new NFError(
        'NF-002',
        `${toPosix(relative(resolve(options.clientDir), fileName))} still has a comment after stripping: no types are published.`
      )
    }
  }

  const checker = program.getTypeChecker()
  const entries = new Map<string, string>()
  for (const [key, source] of Object.entries(sources)) {
    const declaration = declarationOf.get(source)
    const file = program.getSourceFile(source)
    if (!declaration || !file) {
      throw new NFError(
        'NF-002',
        `TypeScript emitted no declarations for ${key} (${toPosix(relative(root, source))}).`
      )
    }
    const entry = join(typesDir, `${key.slice(2)}.d.ts`)
    let specifier = toPosix(relative(dirname(entry), declaration)).replace(
      /\.d\.ts$/,
      '.js'
    )
    if (!specifier.startsWith('.')) specifier = `./${specifier}`
    const symbol = checker.getSymbolAtLocation(file)
    const hasDefault =
      symbol !== undefined &&
      checker.getExportsOfModule(symbol).some((s) => s.name === 'default')
    // A JSON string is a valid TypeScript string literal (a file name may
    // hold a quote or a backslash).
    const from = JSON.stringify(specifier)
    entries.set(
      entry,
      `export * from ${from}\n${
        hasDefault ? `export { default } from ${from}\n` : ''
      }`
    )
  }
  for (const [file, text] of [...outputs, ...entries]) {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, text)
  }
}

/**
 * Every module specifier a declaration file names: import and export
 * declarations, `import x = require()`, `import("…")` types, ambient
 * `declare module "…"` names and `/// <reference path>`.
 */
function declarationSpecifiers(
  ts: TypeScriptApi,
  fileName: string,
  text: string
): string[] {
  const file = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS
  )
  // `/// <reference path>` and `/// <reference types>` (`lib=` names a
  // TypeScript lib, never a path).
  const out = [...file.referencedFiles, ...file.typeReferenceDirectives].map(
    (ref) => ref.fileName
  )
  const literal = (node: TS.Node | undefined): void => {
    if (node && ts.isStringLiteralLike(node)) out.push(node.text)
  }
  const visit = (node: TS.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      literal(node.moduleSpecifier)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      literal(node.moduleReference.expression)
    } else if (ts.isImportTypeNode(node)) {
      const arg = node.argument
      if (ts.isLiteralTypeNode(arg)) literal(arg.literal)
    } else if (ts.isModuleDeclaration(node)) {
      literal(node.name)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out
}

// Triple-slash directives stay (their paths are checked like imports).
const DIRECTIVE = /^\/\/\/\s*<(?:reference|amd-module|amd-dependency)\b/

/**
 * The comments of a declaration file, from TypeScript's own trivia scan
 * around every token (never inside a string or template literal), minus
 * triple-slash directives.
 */
function commentRanges(
  ts: TypeScriptApi,
  fileName: string,
  text: string
): TS.CommentRange[] {
  const file = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const found = new Map<number, TS.CommentRange>()
  const at = (pos: number): void => {
    for (const range of [
      ...(ts.getLeadingCommentRanges(text, pos) ?? []),
      ...(ts.getTrailingCommentRanges(text, pos) ?? []),
    ]) {
      found.set(range.pos, range)
    }
  }
  const walk = (node: TS.Node): void => {
    if (
      node.kind >= ts.SyntaxKind.FirstJSDocNode &&
      node.kind <= ts.SyntaxKind.LastJSDocNode
    ) {
      return
    }
    const children = node.getChildren(file)
    if (children.length === 0) {
      at(node.pos)
      at(node.end)
      return
    }
    for (const child of children) walk(child)
  }
  walk(file)
  at(file.endOfFileToken.pos)
  return [...found.values()]
    .filter((range) => !DIRECTIVE.test(text.slice(range.pos, range.end)))
    .sort((a, b) => a.pos - b.pos)
}

/** The declaration text without its comments (`/*!` ones included). */
function stripComments(
  ts: TypeScriptApi,
  fileName: string,
  text: string
): string {
  let out = ''
  let last = 0
  for (const range of commentRanges(ts, fileName, text)) {
    if (range.pos < last) continue
    out += text.slice(last, range.pos)
    last = range.end
  }
  return out + text.slice(last)
}

const isAbsoluteSpecifier = (specifier: string): boolean =>
  specifier.startsWith('/') ||
  specifier.startsWith('\\') ||
  /^[A-Za-z]:[\\/]/.test(specifier) ||
  /^file:/i.test(specifier)

/**
 * NF-002 when a declaration names an absolute path (the build machine's
 * folders) or a relative path above the remote's root (its monorepo
 * layout). `outDir` mirrors the root (`rootDir`), so a relative specifier
 * resolved from the output file must stay inside it. Package specifiers
 * are fine.
 */
function assertSpecifiersInside(
  ts: TypeScriptApi,
  fileName: string,
  text: string,
  outDir: string,
  clientDir: string
): void {
  for (const specifier of declarationSpecifiers(ts, fileName, text)) {
    let outside = isAbsoluteSpecifier(specifier)
    if (!outside && specifier.startsWith('.')) {
      const rel = relative(outDir, resolve(dirname(fileName), specifier))
      outside = rel.startsWith('..') || isAbsolute(rel)
    }
    if (outside) {
      throw new NFError(
        'NF-002',
        `${toPosix(relative(resolve(clientDir), fileName))} refers to "${specifier}", outside the remote's root: publishing it would reveal the build machine's folder layout.`
      )
    }
  }
}

function failure(
  ts: TypeScriptApi,
  diagnostics: readonly TS.Diagnostic[]
): NFError {
  const text = ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n',
  })
  return new NFError(
    'NF-002',
    `TypeScript could not emit the exposed modules' declarations:\n${text || 'declaration emit was skipped.'}`
  )
}

/** TypeScript 5 and 6 export the compiler API; TypeScript 7 exports only its version. */
function hasCompilerApi(ts: TypeScriptApi): boolean {
  return (
    typeof ts.createProgram === 'function' &&
    typeof ts.sys === 'object' &&
    ts.sys !== null
  )
}

export type BuildTypesOptions = EmitTypesOptions & {
  types: boolean
  /** The remote's `typescript` (`loadTypeScript`), or null without one. */
  ts: TypeScriptApi | null
}

/**
 * `client/@mf-types/` for a build with `types: true`. Never fails the
 * build: without `typescript`, or when TypeScript cannot emit the
 * declarations, it warns and publishes no types. True when emitted.
 */
export async function emitBuildTypes(
  options: BuildTypesOptions
): Promise<boolean> {
  if (!options.types) return false
  const warn = options.warn ?? ((line: string) => logger.warn('NF-002', line))
  if (!options.ts) {
    warn(
      '`types: true` needs the `typescript` package installed in the remote project: this build publishes no types.'
    )
    return false
  }
  if (!hasCompilerApi(options.ts)) {
    const version = String((options.ts as { version?: unknown }).version)
    warn(
      `\`types: true\` needs the TypeScript compiler API, and TypeScript ${version} has no compiler API (TypeScript 7 is the native compiler and ships none). Install TypeScript 6 in the remote project (\`npm install -D typescript@6\`): this build publishes no types.`
    )
    return false
  }
  try {
    await emitExposeTypes(options.ts, options)
    return true
  } catch (error) {
    await rm(join(resolve(options.clientDir), TYPES_FOLDER), {
      recursive: true,
      force: true,
    })
    warn(
      `${error instanceof Error ? error.message : String(error)}\nThis build publishes no types.`
    )
    return false
  }
}
