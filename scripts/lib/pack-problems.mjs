/** Pure checks for a packed tarball; dependency-free so unit tests import it directly. */

const REQUIRED = ['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md']

/** @param {unknown} value @param {string[]} [out] @returns {string[]} */
export function collectExportTargets(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (value && typeof value === 'object')
    for (const inner of Object.values(value)) collectExportTargets(inner, out)
  return out
}

/**
 * @param {string} name package name
 * @param {string[]} files tarball paths relative to the package root
 * @param {unknown} exportsMap the manifest `exports`
 * @returns {string[]} problems, empty when the tarball is publishable
 */
export function checkPack(name, files, exportsMap) {
  const problems = []
  const present = new Set(files)
  for (const file of files) {
    if (!REQUIRED.includes(file) && !file.startsWith('dist/'))
      problems.push(`${name}: unexpected file in tarball: ${file}`)
  }
  for (const file of REQUIRED) {
    if (!present.has(file))
      problems.push(`${name}: required file ${file} is not in the tarball`)
  }
  const targets = [...new Set(collectExportTargets(exportsMap))]
  if (targets.length === 0) {
    problems.push(`${name}: exports map has no file targets`)
  }
  for (const target of targets) {
    if (!target.startsWith('./')) continue
    if (!present.has(target.slice(2)))
      problems.push(`${name}: exports target ${target} is not in the tarball`)
  }
  return problems
}
