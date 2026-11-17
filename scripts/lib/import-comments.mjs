const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r'

/**
 * The block comments of the first `import( /* … *\/ … arg )` call in `source`
 * (with the whitespace between them), or null when there is none. A scan,
 * not a regex: `(?:\/\*[^]*?\*\/\s*)+` backtracks exponentially.
 */
export function importCallComments(source, arg) {
  let from = 0
  for (;;) {
    const at = source.indexOf('import(', from)
    if (at === -1) return null
    from = at + 'import('.length
    let i = from
    while (isSpace(source[i])) i++
    const start = i
    while (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2)
      if (end === -1) return null // no later comment can close either
      i = end + 2
      while (isSpace(source[i])) i++
    }
    if (i === start || !source.startsWith(arg, i)) continue
    let j = i + arg.length
    while (isSpace(source[j])) j++
    if (source[j] === ')') return source.slice(start, i)
  }
}
