import { parseFragment } from 'parse5'
import { stripIslandHtml } from '../src/strip-html.ts'

const strip = (h: string): string => stripIslandHtml(h).html

describe('stripIslandHtml', () => {
  test('removes script elements with their content', () =>
    expect(strip('<p>a</p><script>x("</p>")</script><p>b</p>')).toBe(
      '<p>a</p><p>b</p>'
    ))

  test('removes modulepreload links and reports them', () => {
    const r = stripIslandHtml(
      '<link rel="modulepreload" href="/a.js"/><div>x</div>'
    )
    expect(r.html).toBe('<div>x</div>')
    expect(r.removed).toEqual([
      { tag: 'link', attrs: ' rel="modulepreload" href="/a.js"/' },
    ])
  })

  test('removes meta, base and title and reports them in order', () => {
    const r = stripIslandHtml(
      '<meta charset="utf-8"><base href="/x/"><title>Hi &amp; bye</title><p>k</p>'
    )
    expect(r.html).toBe('<p>k</p>')
    expect(r.removed.map((x) => x.tag)).toEqual(['meta', 'base', 'title'])
    expect(r.removed[0]).toEqual({ tag: 'meta', attrs: ' charset="utf-8"' })
  })

  test('keeps <title> inside <svg>', () =>
    expect(strip('<svg><title>t</title></svg>')).toBe(
      '<svg><title>t</title></svg>'
    ))

  test('removes <title> again after the svg closes', () =>
    expect(strip('<svg><title>t</title></svg><title>x</title>y')).toBe(
      '<svg><title>t</title></svg>y'
    ))

  test('removes <title> inside svg foreignObject (html integration point)', () =>
    expect(
      strip('<svg><foreignObject><title>x</title></foreignObject></svg>')
    ).toBe('<svg><foreignObject></foreignObject></svg>'))

  test('keeps plain <style> and removes <style precedence> / <style href>', () => {
    expect(strip('<style>a{b:c}</style>x')).toBe('<style>a{b:c}</style>x')
    expect(strip('<style data-precedence="x">a{}</style>x')).toBe(
      '<style data-precedence="x">a{}</style>x'
    )
    expect(strip('<style precedence="default" href="a">a{}</style>x')).toBe('x')
    expect(strip('<STYLE HREF=a>a{}</STYLE>x')).toBe('x')
  })

  test('a ">" inside a quoted attribute does not end the tag', () =>
    expect(strip('<a title="x > <script>y</script>">k</a>')).toBe(
      '<a title="x &gt; &lt;script&gt;y&lt;/script&gt;">k</a>'
    ))

  test('a ">" inside a quoted attribute of a script does not end the tag', () =>
    expect(strip(`<script data-x='>' >alert(1)</script>ok`)).toBe('ok'))

  test('escaped text is untouched', () =>
    expect(strip('<p>&lt;script&gt;1&lt;/script&gt;</p>')).toBe(
      '<p>&lt;script&gt;1&lt;/script&gt;</p>'
    ))

  test('is case-insensitive', () => {
    expect(strip('<SCRIPT>1</ScRiPt>ok')).toBe('ok')
    expect(strip('<LINK rel=x><META name=a><Title>t</TITLE>ok')).toBe('ok')
  })

  test('script close tags may carry whitespace, slashes and attributes', () => {
    expect(strip('<script>1</script >ok')).toBe('ok')
    expect(strip('<script>1</script\n>ok')).toBe('ok')
    expect(strip('<script>1</script/>ok')).toBe('ok')
    expect(strip('<script>1</script x=">">ok')).toBe('ok')
  })

  test('</scripts> and </scriptx> do not close a script', () =>
    expect(strip('<script>a</scriptx>b</script>ok')).toBe('ok'))

  test('a script tag name ends at "/" (<script/src=...>)', () =>
    expect(strip('<script/src=x>1</script>ok')).toBe('ok'))

  test('removes scripts inside svg, self-closing or not', () => {
    expect(strip('<svg><script>alert(1)</script><g/></svg>')).toBe(
      '<svg><g></g></svg>'
    )
    expect(strip('<svg><script href="a"/><g/></svg>')).toBe(
      '<svg><g></g></svg>'
    )
  })

  test('removes scripts inside svg <title> and <style> children', () => {
    expect(strip('<svg><title><script>1</script></title></svg>')).toBe(
      '<svg><title></title></svg>'
    )
    expect(strip('<svg><style><script>1</script></style></svg>')).toBe(
      '<svg><style></style></svg>'
    )
  })

  test('comments are preserved verbatim, including a script inside one', () => {
    expect(strip('a<!-- <script>x</script> -->b')).toBe(
      'a<!-- <script>x</script> -->b'
    )
    expect(strip('<!--x--!><script>1</script>y')).toBe('<!--x-->y')
    expect(strip('<!--><script>1</script>y')).toBe('<!---->y')
    expect(strip('<!---><script>1</script>y')).toBe('<!---->y')
  })

  test('an unterminated comment keeps the rest verbatim', () =>
    expect(strip('a<!-- <script>x</script>')).toBe(
      'a<!-- <script>x</script>-->'
    ))

  test('CDATA: bogus comment in html, real section in svg', () => {
    expect(strip('<![CDATA[ x ]]><script>1</script>y')).toBe(
      '<!--[CDATA[ x ]]-->y'
    )
    expect(
      strip('<svg><![CDATA[ <script>1</script> ]]></svg><script>2</script>z')
    ).toBe('<svg> &lt;script&gt;1&lt;/script&gt; </svg>z')
  })

  test('html-context CDATA ends at the first ">" like a bogus comment', () =>
    expect(strip('<![CDATA[ a > <script>1</script>b')).toBe(
      '<!--[CDATA[ a --> b'
    ))

  test('doctype and processing instructions pass through', () =>
    expect(strip('<!DOCTYPE html><?x <script> ?><p>a</p>')).toBe(
      '<!--?x <script--> ?&gt;<p>a</p>'
    ))

  test('textarea and title-like text content that looks like a tag is preserved', () => {
    expect(strip('<textarea><script>1</script><link></textarea>x')).toBe(
      '<textarea>&lt;script&gt;1&lt;/script&gt;&lt;link&gt;</textarea>x'
    )
    expect(strip('<iframe><script>1</script></iframe>x')).toBe(
      '<iframe><script>1</script></iframe>x'
    )
  })

  test('script text containing tag-like strings is consumed to the real close', () =>
    expect(strip('<script>if(a<b){"<link>"}</script><p>k</p>')).toBe(
      '<p>k</p>'
    ))

  test('an unterminated script drops the remainder', () =>
    expect(strip('<p>a</p><script>never closed')).toBe('<p>a</p>'))

  test('an unterminated removed title or style drops the remainder', () => {
    expect(strip('<p>a</p><title>never')).toBe('<p>a</p>')
    expect(strip('<p>a</p><style precedence=x>never')).toBe('<p>a</p>')
  })

  test('an unterminated script start tag at end of input is dropped', () =>
    expect(strip('<p>a</p><script src="x"')).toBe('<p>a</p>'))

  test('an unterminated kept tag is discarded, as a browser does', () =>
    expect(strip('<p>a</p><div class="x')).toBe('<p>a</p>'))

  test('a lone "<" and non-tag "<" are text', () =>
    expect(strip('a < b <3 <script>1</script>c')).toBe('a &lt; b &lt;3 c'))

  test('end tags with quoted ">" are tokenized', () =>
    expect(strip('</p title=">"><script>1</script>x')).toBe('x'))

  test('script-like element names are not matched by prefix', () =>
    expect(
      strip('<scripty>a</scripty><linked/><metadata/><titles>t</titles>')
    ).toBe(
      '<scripty>a</scripty><linked><metadata><titles>t</titles></metadata></linked>'
    ))

  test('removing adjacent elements leaves surrounding text intact', () =>
    expect(strip('a<script>1</script>b<script>2</script>c<link>d')).toBe(
      'abcd'
    ))

  test('React SSR output without hoistables keeps text, whitespace and markers', () => {
    const fixture =
      '<div class="card" data-x="a &gt; b"><h2>Total: <!-- -->42</h2><p>5 &lt; 6 &amp;&amp; &quot;ok&quot;</p>' +
      '<button type="button" aria-label="Add &lt;script&gt;">+</button><ul><li>a</li><!--$--><li>b</li><!--/$--><!--$!--><template data-dgst="x"></template><!--/$!--></ul>' +
      '<pre>\n\n  keep  </pre><textarea>x &lt;/textarea&gt;</textarea><svg viewBox="0 0 1 1"><path d="M0 0L1 1"/></svg>' +
      '<img src="/a.png" alt="a > b"/><input value="&lt;title&gt;"/> tail  space</div>'
    const r = stripIslandHtml(fixture)
    expect(r.removed).toEqual([])
    // Normalized the way a browser would (void tags lose "/", `"` is unescaped in text).
    expect(r.html).toBe(
      '<div class="card" data-x="a &gt; b"><h2>Total: <!-- -->42</h2><p>5 &lt; 6 &amp;&amp; "ok"</p>' +
        '<button type="button" aria-label="Add &lt;script&gt;">+</button><ul><li>a</li><!--$--><li>b</li><!--/$--><!--$!--><template data-dgst="x"></template><!--/$!--></ul>' +
        '<pre>\n\n  keep  </pre><textarea>x &lt;/textarea&gt;</textarea><svg viewBox="0 0 1 1"><path d="M0 0L1 1"></path></svg>' +
        '<img src="/a.png" alt="a &gt; b"><input value="&lt;title&gt;"> tail  space</div>'
    )
    expect(strip(r.html)).toBe(r.html) // idempotent
  })

  test('script and hoistables inside <template> content are removed', () =>
    expect(strip('<template><script>1</script><p>a</p><link></template>')).toBe(
      '<template><p>a</p></template>'
    ))
})

describe('parser-differential leaks', () => {
  const executableScripts = (html: string): number => {
    let count = 0
    type N = { tagName?: string; childNodes?: N[]; content?: N }
    const walk = (n: N): void => {
      if (n.tagName === 'script') count++
      for (const c of n.childNodes ?? []) walk(c)
      if (n.content) walk(n.content)
    }
    walk(parseFragment(html) as unknown as N)
    return count
  }
  const leaks: Record<string, string> = {
    'foreignObject breakout':
      '<svg><foreignObject><div></svg></div></foreignObject><style><script>alert(1)</script></style></svg>',
    'mglyph in mathml text point':
      '<math><mi><mglyph><style><p></p><script>alert(1)</script></style></mi></math>',
    malignmark:
      '<math><mi><malignmark><style><p></p><script>alert(1)</script></style></mi></math>',
    'xmp in select': '<select><xmp><script>alert(1)</script></xmp></select>',
    'style in select':
      '<select><style><script>alert(1)</script></style></select>',
    'iframe in select':
      '<select><iframe><script>alert(1)</script></iframe></select>',
    'double-escaped script':
      '<script><!--<script>1</script>EVIL<script>2</script></script>',
  }
  for (const [name, input] of Object.entries(leaks)) {
    test(`no executable script survives: ${name}`, () => {
      expect(executableScripts(input)).toBeGreaterThan(0) // the input does contain one
      expect(executableScripts(strip(input))).toBe(0)
    })
  }

  test('foreign-content breakout: an html <title> after <svg><p> is removed', () => {
    const r = stripIslandHtml('<svg><p><title>t</title>x')
    expect(r.html).not.toContain('<title')
    expect(r.removed.map((x) => x.tag)).toEqual(['title'])
  })

  test('<plaintext> content is kept as text', () =>
    expect(strip('<plaintext><script>1</script>')).toBe(
      '<plaintext><script>1</script></plaintext>'
    ))
})

describe('performance', () => {
  // Wall-clock limits flake on loaded machines, so assert scaling instead: time two input sizes
  // (best of 5) and compare. Linear growth gives a ratio near the size ratio (4); quadratic ~16.
  const time = (input: string): number => {
    const runs: number[] = []
    for (let i = 0; i < 5; i++) {
      const t = performance.now()
      stripIslandHtml(input)
      runs.push(performance.now() - t)
    }
    // Best of 5: the least disturbed run (other test files run in parallel).
    return Math.min(...runs)
  }
  const HANG_GUARD_MS = 30_000

  test('React text-separator comments scale linearly (256 KB -> 1 MB)', () => {
    const unit = '<span>a<!-- -->b</span>'
    const make = (bytes: number): string =>
      unit.repeat(Math.ceil(bytes / unit.length))
    const big = make(1024 * 1024)
    stripIslandHtml(make(64 * 1024)) // warm up
    const small = time(make(256 * 1024))
    const t0 = performance.now()
    const large = time(big)
    expect(performance.now() - t0).toBeLessThan(HANG_GUARD_MS)
    expect(large / small).toBeLessThan(8)
    expect(stripIslandHtml(big).html.length).toBe(big.length)
  }, 120_000)

  test('deep nesting scales linearly (2500 -> 10000 levels)', () => {
    const make = (d: number): string =>
      '<div>'.repeat(d) + 'x' + '</div>'.repeat(d)
    stripIslandHtml(make(1000)) // warm up
    const small = time(make(2500))
    const t0 = performance.now()
    const large = time(make(10000))
    expect(performance.now() - t0).toBeLessThan(HANG_GUARD_MS)
    expect(large / small).toBeLessThan(8)
  }, 120_000)
})
