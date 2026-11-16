import { NFError } from '@next-federation/sdk'

const fail = (path: string, why: string): never => {
  throw new NFError('NF-009', `${why} at ${path || '<root>'}.`)
}

function write(value: unknown, path: string, stack: Set<object>): string {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      return Number.isFinite(value)
        ? JSON.stringify(value)
        : fail(path, `${value} is not JSON`)
    case 'undefined':
      return fail(path, 'undefined is not JSON')
    case 'function':
    case 'symbol':
    case 'bigint':
      return fail(path, `a ${typeof value} is not JSON`)
  }
  if (value === null) return 'null'
  const obj = value as object
  if (stack.has(obj)) return fail(path, 'a cyclic reference')
  stack.add(obj)
  try {
    if (Array.isArray(obj)) {
      const parts: string[] = []
      for (let i = 0; i < obj.length; i++) {
        if (!(i in obj)) fail(`${path}[${i}]`, 'a sparse array slot')
        parts.push(write(obj[i], `${path}[${i}]`, stack))
      }
      return `[${parts.join(',')}]`
    }
    const proto = Object.getPrototypeOf(obj)
    if (proto !== Object.prototype && proto !== null) {
      return fail(path, 'a non-plain object (Date, Map, Set or class instance)')
    }
    const record = obj as Record<string, unknown>
    const parts: string[] = []
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue
      parts.push(
        `${JSON.stringify(key)}:${write(record[key], `${path}.${key}`, stack)}`
      )
    }
    return `{${parts.join(',')}}`
  } finally {
    stack.delete(obj)
  }
}

/** JSON with sorted object keys and no whitespace; throws `NF-009` for anything not plain JSON. */
export function canonicalJson(value: unknown): string {
  return write(value, '', new Set())
}
