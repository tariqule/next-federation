// Build-time sync: copies the repo's Markdown and MDX (docs/ and package
// READMEs) into docs-site/content/docs (git-ignored), adding the frontmatter
// Fumadocs needs and rewriting relative links to site URLs. The source files
// are never edited.
//
// .mdx sources carry their own frontmatter (title, description), which is kept;
// one without it falls back to the first "# " heading. .md sources (package
// READMEs, the protocol spec, error pages) have no frontmatter: title and
// description are derived from the file itself.
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

add('docs/index.mdx', 'index')
add('docs/live-demo.md', 'live-demo')
add('docs/architecture.md', 'architecture')
add('docs/guides/getting-started-app-router.mdx', 'getting-started/app-router')
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
add('docs/guides/server-actions.md', 'guides/server-actions')
add('docs/guides/csp.md', 'guides/csp')
add('docs/guides/limits.md', 'guides/limits')
add(
  'docs/guides/migrating-from-nextjs-mf.md',
  'guides/migrating-from-nextjs-mf'
)
add('docs/guides/remote-components/overview.mdx', 'remote-components/overview')
add(
  'docs/guides/remote-components/vite-remote.mdx',
  'remote-components/vite-remote'
)
add(
  'docs/guides/remote-components/rspack-remote.mdx',
  'remote-components/rspack-remote'
)
add(
  'docs/guides/remote-components/host-configuration.mdx',
  'remote-components/host-configuration'
)
add(
  'docs/guides/remote-components/stylesheets.mdx',
  'remote-components/stylesheets'
)
add(
  'docs/guides/remote-components/sharing-modules.mdx',
  'remote-components/sharing-modules'
)
add('docs/guides/remote-components/links.mdx', 'remote-components/links')
add(
  'docs/guides/remote-components/reference.mdx',
  'remote-components/reference'
)
add(
  'docs/guides/remote-components/sharing-from-a-next-app.mdx',
  'remote-components/sharing-from-a-next-app'
)
add('docs/guides/deployment.md', 'deployment/overview')
add('docs/guides/self-hosted-skew.md', 'deployment/self-hosted-skew')
add(
  'docs/guides/deploying-a-remote-on-vercel.md',
  'deployment/deploying-a-remote-on-vercel'
)
add('docs/protocol/v1.md', 'protocol/v1')

// The error pages stay .md: the library links to docs/errors/<slug>.md on
// GitHub (DOCS_BASE in @next-federation/sdk). Only the index is .mdx.
add('docs/errors/index.mdx', 'errors/index')
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
  // A folder's index page is served at the folder URL (errors/index -> /docs/errors).
  const route = slug.replace(/(^|\/)index$/, '')
  urlBySource.set(path.join(repoRoot, src), route ? `/docs/${route}` : '/docs')
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
  // Package READMEs link to docs with absolute GitHub URLs (they must work on
  // npm); on the site those go to the matching page.
  const blob = `${GITHUB}/blob/main/`
  if (target.startsWith(blob)) {
    const [file, hash = ''] = target.slice(blob.length).split('#')
    const url = urlBySource.get(path.join(repoRoot, file))
    if (url) return url + (hash ? `#${hash}` : '')
  }
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

// Rewrites `[text](target)` and JSX `href="target"` outside fenced code blocks
// and inline code spans.
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
            : part
                .replace(
                  /(\]\()([^)\s]+)(\))/g,
                  (_, a, target, c) => a + rewriteTarget(target, srcAbs) + c
                )
                .replace(
                  /(\shref=")([^"]+)(")/g,
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
  if (text.length <= 155) return text
  const cut = text.slice(0, 155)
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]$/, '') + '...'
}

rmSync(outRoot, { recursive: true, force: true })

let count = 0
const errorOrder = []
for (const { src, slug } of entries) {
  const srcAbs = path.join(repoRoot, src)
  const isMdx = src.endsWith('.mdx')
  const text = readFileSync(srcAbs, 'utf8')
  const own = isMdx ? text.match(/^---\n([\s\S]*?)\n---\n/) : null
  let title
  let description
  let rest
  if (own) {
    // Frontmatter written in the source: keep it verbatim, read the title.
    const t = own[1].match(/^title:\s*(.+)$/m)
    if (!t) throw new Error(`${src}: frontmatter has no title`)
    title = plain(t[1].replace(/^["']|["']$/g, ''))
    rest = text.slice(own[0].length).split('\n')
    if (!/^description:/m.test(own[1]))
      throw new Error(`${src}: frontmatter has no description`)
  } else {
    const lines = text.split('\n')
    const h1 = lines.findIndex((l) => /^# \S/.test(l))
    if (h1 === -1) throw new Error(`${src}: no "# " heading to use as title`)
    title = plain(lines[h1].slice(2))
    rest = lines.slice(h1 + 1)
    description = firstParagraph(rest)
  }
  const body = rewriteLinks(rest.join('\n').replace(/^\n+/, ''), srcAbs)
  const front = own
    ? `---\n${own[1]}\n---\n`
    : [
        '---',
        `title: ${JSON.stringify(title)}`,
        description ? `description: ${JSON.stringify(description)}` : null,
        '---',
        '',
      ]
        .filter((l) => l !== null)
        .join('\n')
  const dest = path.join(outRoot, `${slug}${isMdx ? '.mdx' : '.md'}`)
  mkdirSync(path.dirname(dest), { recursive: true })
  writeFileSync(dest, `${front}\n${body}`)
  count++
  const code = title.match(/^NF-(\d+)/)
  if (slug.startsWith('errors/') && slug !== 'errors/index') {
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
// Sidebar order, as in the Next.js docs: Getting Started, Guides, Remote
// Components, Deployment, API Reference, Errors, then Architecture. The page
// map in docs/maintainers/docs-style.md says where later phases split pages.
writeFileSync(
  path.join(outRoot, 'meta.json'),
  JSON.stringify(
    {
      pages: [
        'index',
        'live-demo',
        'getting-started',
        'guides',
        'remote-components',
        'deployment',
        'api',
        'errors',
        '---Architecture---',
        'architecture',
        'protocol',
      ],
    },
    null,
    2
  ) + '\n'
)
meta('getting-started', 'Getting Started', [
  'app-router',
  'pages-router',
  'spa',
])
meta('guides', 'Guides', [
  'writing-an-island-remote',
  'server-actions',
  'caching',
  'identity',
  'csp',
  'limits',
  'migrating-from-nextjs-mf',
])
meta('remote-components', 'Remote Components', [
  'overview',
  'sharing-from-a-next-app',
])
meta('deployment', 'Deployment', [
  'overview',
  'self-hosted-skew',
  'deploying-a-remote-on-vercel',
])
meta('errors', 'Errors', ['index', ...errorOrder.map((e) => e.slug)])
meta('protocol', 'Protocol', ['v1'])
meta('api', 'API Reference', packageDirs)

console.log(`docs-site: synced ${count} pages into content/docs`)
