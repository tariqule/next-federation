import { codeLiteral } from '../src/code-literal.ts'

const LS = String.fromCharCode(0x2028)
const PS = String.fromCharCode(0x2029)

const tricky = {
  name: '</script><script>alert(1)</script>',
  sep: `a${LS}b${PS}c`,
  html: '<!-- x -->',
  plain: 'react-dom/client',
}

test('a value reads back as itself when the literal is evaluated as JavaScript', () => {
  const source = codeLiteral(tricky)
  expect(new Function(`return ${source}`)()).toEqual(tricky)
  expect(codeLiteral('react')).toBe('"react"')
})

test('the literal holds no <, >, U+2028 or U+2029, so it cannot end an inline <script>', () => {
  const source = codeLiteral(tricky)
  for (const c of ['<', '>', LS, PS]) expect(source.includes(c)).toBe(false)
})
