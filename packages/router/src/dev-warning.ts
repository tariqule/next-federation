// One development warning per key. The router package (and the shims a
// remote build bundles from it) stays free of `@next-federation/sdk`: it
// ships inside remotes, so this writes to the console directly.
const warned = new Set<string>()

export function warnOnceInDevelopment(key: string, message: string): void {
  // Replaced by the remote's bundler: nothing is logged in production.
  if (process.env.NODE_ENV === 'production' || warned.has(key)) return
  warned.add(key)
  // eslint-disable-next-line no-console -- see the file comment
  console.warn(`[ next-federation ] ${message}`)
}
