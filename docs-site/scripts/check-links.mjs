// Crawls a running docs site (default http://localhost:3300), follows every
// internal link from the home page and fails on any non-200 page or any
// internal link that does not resolve. Also checks that search answers.
//
//   node scripts/check-links.mjs [baseUrl]
const base = (process.argv[2] ?? 'http://localhost:3300').replace(/\/$/, '')

const seen = new Map() // path -> status
const broken = [] // { from, to, status }
const queue = [{ path: '/', from: '(start)' }]
const linkRe = /href="([^"#]+)(?:#[^"]*)?"/g

while (queue.length) {
  const { path, from } = queue.shift()
  if (seen.has(path)) {
    if (seen.get(path) !== 200)
      broken.push({ from, to: path, status: seen.get(path) })
    continue
  }
  const res = await fetch(base + path, { redirect: 'follow' })
  seen.set(path, res.status)
  if (res.status !== 200) {
    broken.push({ from, to: path, status: res.status })
    continue
  }
  if (!(res.headers.get('content-type') ?? '').includes('text/html')) continue
  const html = await res.text()
  for (const m of html.matchAll(linkRe)) {
    const href = m[1].replace(/&amp;/g, '&')
    if (!href.startsWith('/') || href.startsWith('//')) continue
    if (href.startsWith('/_next/') || href.startsWith('/api/')) continue
    queue.push({ path: href.replace(/\/$/, '') || '/', from: path })
  }
}

const search = await fetch(
  `${base}/api/search?query=${encodeURIComponent('caching')}`
)
const hits = search.ok ? await search.json() : []
const searchOk = Array.isArray(hits) && hits.length > 0

const pages = [...seen.entries()].filter(([, s]) => s === 200).length
console.log(
  `crawled ${seen.size} pages, ${pages} ok, ${broken.length} broken links`
)
console.log(
  `search "caching": ${searchOk ? `${hits.length} hits` : 'NO RESULTS'}`
)
for (const b of broken)
  console.log(`  BROKEN ${b.status} ${b.to} (from ${b.from})`)
process.exit(broken.length || !searchOk ? 1 : 0)
