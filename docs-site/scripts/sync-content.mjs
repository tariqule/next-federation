// Build-time sync: copies the repo's Markdown (docs/ and package READMEs) into
// docs-site/content/docs (git-ignored), adding the frontmatter Fumadocs needs
// (title and description, derived from the file itself) and rewriting relative
// links to site URLs. The source Markdown is never edited.
//
// A sync script is used instead of pointing Fumadocs at ../docs directly
// because the content comes from several unrelated folders and needs links
// rewritten; one generated tree keeps both the build and the link check simple,
// and it works on Vercel as long as the build can see the repo root.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const siteRoot = path.resolve(here, '..')
const repoRoot = path.resolve(siteRoot, '..')
const outRoot = path.join(siteRoot, 'content', 'docs')
const GITHUB = 'https://github.com/tariqule/next-federation'

if (!existsSync(path.join(repoRoot, 'docs', 'guides'))) {
  throw new Error(
    `docs-site build needs the repo's docs/ folder at ${repoRoot}; deploy with the repo root visible`
  )
}

// Each entry: source path relative to the repo root, destination slug under /docs.
const entries = []
const add = (src, slug) => entries.push({ src, slug })

add('docs/guides/getting-started-app-router.md', 'getting-started/app-router')
add(
  'docs/guides/getting-started-pages-router.md',
  'getting-started/pages-router'
)
add('docs/guides/getting-started-spa.md', 'getting-started/spa')
add(
  'docs/guides/writing-an-island-remote.md',
  'guides/writing-an-island-remote'
)
add('docs/guides/caching.md', 'guides/caching')
add('docs/guides/identity.md', 'guides/identity')
add('docs/guides/csp.md', 'guides/csp')
add('docs/guides/limits.md', 'guides/limits')
add(
  'docs/guides/migrating-from-nextjs-mf.md',
  'guides/migrating-from-nextjs-mf'
)
add('docs/guides/client-components.md', 'client-components/overview')
add(
  'docs/guides/sharing-components-from-a-next-app.md',
  'client-components/sharing-from-a-next-app'
)
add('docs/guides/deployment.md', 'deployment/overview')
add('docs/guides/self-hosted-skew.md', 'deployment/self-hosted-skew')
add('docs/protocol/v1.md', 'protocol/v1')

const errorFiles = readdirSync(path.join(repoRoot, 'docs/errors'))
  .filter((f) => f.endsWith('.md'))
  .sort()
for (const f of errorFiles) {
  add(`docs/errors/${f}`, `errors/${f.replace(/\.md$/, '')}`)
}

const packageDirs = readdirSync(path.join(repoRoot, 'packages'), {
  withFileTypes: true,
})
  .filter(
    (d) =>
      d.isDirectory() &&
      existsSync(path.join(repoRoot, 'packages', d.name, 'README.md'))
  )
  .map((d) => d.name)
  .sort()
for (const p of packageDirs) add(`packages/${p}/README.md`, `api/${p}`)

// source (absolute path) -> site URL
const urlBySource = new Map()
for (const { src, slug } of entries) {
  urlBySource.set(path.join(repoRoot, src), `/docs/${slug}`)
}
for (const p of packageDirs) {
  // A link to the package directory lands on its README page.
  urlBySource.set(path.join(repoRoot, 'packages', p), `/docs/api/${p}`)
}

function toGithub(abs) {
  const rel = path.relative(repoRoot, abs).split(path.sep).join('/')
  const isDir = existsSync(abs) && !/\.[a-z0-9]+$/i.test(rel)
  return `${GITHUB}/${isDir ? 'tree' : 'blob'}/main/${rel}`
}

function rewriteTarget(target, srcAbs) {
  if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return target
  const hashAt = target.indexOf('#')
  const rawPath = hashAt === -1 ? target : target.slice(0, hashAt)
  const hash = hashAt === -1 ? '' : target.slice(hashAt)
  if (!rawPath) return target
  const abs = path.resolve(path.dirname(srcAbs), rawPath).replace(/\/$/, '')
  const url = urlBySource.get(abs)
  if (url) return url + hash
  return toGithub(abs) + hash
}

// Rewrites `[text](target)` outside fenced code blocks and inline code spans.
function rewriteLinks(body, srcAbs) {
  let fence = null
  return body
    .split('\n')
    .map((line) => {
      const m = line.match(/^\s*(`{3,}|~{3,})/)
      if (m) {
        if (!fence) fence = m[1][0]
        else if (m[1][0] === fence) fence = null
        return line
      }
      if (fence) return line
      return line
        .split(/(`[^`]*`)/)
        .map((part) =>
          part.startsWith('`')
            ? part
            : part.replace(
                /(\]\()([^)\s]+)(\))/g,
                (_, a, target, c) => a + rewriteTarget(target, srcAbs) + c
              )
        )
        .join('')
    })
    .join('\n')
}

function plain(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstParagraph(lines) {
  const out = []
  let fence = false
  for (const line of lines) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) fence = !fence
    if (fence) {
      if (out.length) break
      continue
    }
    if (/^\s*$/.test(line)) {
      if (out.length) break
      continue
    }
    if (/^(#|>|\||[-*]\s|\d+\.\s|<)/.test(line)) {
      if (out.length) break
      continue
    }
    out.push(line)
  }
  const text = plain(out.join(' '))
  if (text.length <= 200) return text
  const cut = text.slice(0, 200)
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]$/, '') + '...'
}

rmSync(outRoot, { recursive: true, force: true })

let count = 0
const errorOrder = []
for (const { src, slug } of entries) {
  const srcAbs = path.join(repoRoot, src)
  const lines = readFileSync(srcAbs, 'utf8').split('\n')
  const h1 = lines.findIndex((l) => /^# \S/.test(l))
  if (h1 === -1) throw new Error(`${src}: no "# " heading to use as title`)
  const title = plain(lines[h1].slice(2))
  const rest = lines.slice(h1 + 1)
  const description = firstParagraph(rest)
  const body = rewriteLinks(rest.join('\n').replace(/^\n+/, ''), srcAbs)
  const front = [
    '---',
    `title: ${JSON.stringify(title)}`,
    description ? `description: ${JSON.stringify(description)}` : null,
    '---',
    '',
  ]
    .filter((l) => l !== null)
    .join('\n')
  const dest = path.join(outRoot, `${slug}.md`)
  mkdirSync(path.dirname(dest), { recursive: true })
  writeFileSync(dest, `${front}\n${body}`)
  count++
  const code = title.match(/^NF-(\d+)/)
  if (slug.startsWith('errors/')) {
    if (!code)
      throw new Error(`${src}: error page title must start with NF-nnn`)
    errorOrder.push({ slug: slug.slice('errors/'.length), n: Number(code[1]) })
  }
}

errorOrder.sort((a, b) => a.n - b.n)
const meta = (dir, title, pages) => {
  mkdirSync(path.join(outRoot, dir), { recursive: true })
  writeFileSync(
    path.join(outRoot, dir, 'meta.json'),
    JSON.stringify({ title, pages }, null, 2) + '\n'
  )
}
writeFileSync(
  path.join(outRoot, 'meta.json'),
  JSON.stringify(
    {
      pages: [
        'getting-started',
        'guides',
        'client-components',
        'deployment',
        'errors',
        'protocol',
        'api',
      ],
    },
    null,
    2
  ) + '\n'
)
meta('getting-started', 'Getting started', [
  'app-router',
  'pages-router',
  'spa',
])
meta('guides', 'Guides', [
  'writing-an-island-remote',
  'caching',
  'identity',
  'csp',
  'limits',
  'migrating-from-nextjs-mf',
])
meta('client-components', 'Client components (Mode A)', [
  'overview',
  'sharing-from-a-next-app',
])
meta('deployment', 'Deployment', ['overview', 'self-hosted-skew'])
meta(
  'errors',
  'Error codes',
  errorOrder.map((e) => e.slug)
)
meta('protocol', 'Protocol', ['v1'])
meta('api', 'API (packages)', packageDirs)

console.log(`docs-site: synced ${count} pages into content/docs`)
