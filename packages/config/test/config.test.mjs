import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ESLint } from 'eslint'
import * as prettier from 'prettier'
import { astro, node, react } from '../eslint.js'
import prettierConfig from '../prettier.js'

const lint = async (config, text, filePath) => {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: config, cwd: import.meta.dirname })
  const [result] = await eslint.lintText(text, { filePath })
  return result.messages.map((m) => m.ruleId)
}

test('node: catches undefined names and unused variables, knows Node globals', async () => {
  assert.deepEqual(await lint(node, 'const a = 1\nconsole.log(b)\n', 'x.mjs'), ['no-unused-vars', 'no-undef'])
  assert.deepEqual(await lint(node, 'console.log(process.env.HOME, Buffer.from(""))\n', 'x.mjs'), [])
})

test('node: unused arguments starting with _ are allowed', async () => {
  assert.deepEqual(await lint(node, 'export const f = (_req, res) => res\n', 'x.mjs'), [])
})

test('every preset: _ variables, rest-sibling omits and caught errors are allowed; other unused names are not', async () => {
  const code = [
    'export const publicUser = (user) => {',
    '  const { passwordHash, ...rest } = user',
    '  const _debug = rest.id',
    '  try {',
    '    return JSON.parse(rest.profile)',
    '  } catch (err) {',
    '    return rest',
    '  }',
    '}',
    '',
  ].join('\n')
  for (const [preset, filePath] of [
    [node, 'x.mjs'],
    [astro, 'src/lib/user.js'],
    [react, 'src/lib/user.js'],
  ]) {
    assert.deepEqual(await lint(preset, code, filePath), [])
    assert.deepEqual(await lint(preset, 'const debug = 1\nconst { a } = {}\n', filePath), [
      'no-unused-vars',
      'no-unused-vars',
    ])
  }
})

test('node: no formatting rules (mixed quotes and semicolons are Prettier’s business)', async () => {
  assert.deepEqual(await lint(node, 'export const a = \'x\'; export const b = "y"\n', 'x.mjs'), [])
})

test('astro: lints .astro frontmatter and knows browser globals in pages', async () => {
  const page =
    '---\nconst title = "Home"\nconst unused = 1\n---\n<h1>{title}</h1>\n<script>document.title = "x"</script>\n'
  assert.deepEqual(await lint(astro, page, 'src/pages/index.astro'), ['no-unused-vars'])
})

test('astro: config files and scripts get Node globals', async () => {
  assert.deepEqual(await lint(astro, 'console.log(process.env.SITE_URL)\n', 'astro.config.mjs'), [])
  assert.deepEqual(await lint(astro, 'console.log(process.env.SITE_URL)\n', 'src/lib/site.js'), ['no-undef'])
})

const component = [
  "import { useState } from 'react'",
  "import { Card } from './Card.jsx'",
  '',
  'export function Counter() {',
  '  const [count, setCount] = useState(0)',
  '  return (',
  '    <Card>',
  "      <button onClick={() => setCount(count + 1)}>Don't stop: {count}</button>",
  '    </Card>',
  '  )',
  '}',
  '',
  "document.title = 'x'",
  '',
].join('\n')

test('react: a component lints clean, with JSX-used imports counted as used and browser globals in src/', async () => {
  assert.deepEqual(await lint(react, component, 'src/component/Counter.jsx'), [])
})

test('react: catches hooks violations and unused variables', async () => {
  const conditional = [
    "import { useState } from 'react'",
    '',
    'export function Field({ show }) {',
    '  const unused = 1',
    '  if (show) {',
    '    const [value] = useState(0)',
    '    return <p>{value}</p>',
    '  }',
    '  return null',
    '}',
    '',
  ].join('\n')
  assert.deepEqual(await lint(react, conditional, 'src/component/Field.jsx'), [
    'no-unused-vars',
    'react-hooks/rules-of-hooks',
  ])
})

test('react: src/ is browser code; config files and tests get Node globals', async () => {
  assert.deepEqual(await lint(react, 'console.log(process.env.PORT)\n', 'vite.config.js'), [])
  assert.deepEqual(await lint(react, 'console.log(process.env.PORT)\n', 'src/component/App.test.jsx'), [])
  assert.deepEqual(await lint(react, 'console.log(process.env.PORT)\n', 'src/lib/api.js'), ['no-undef'])
})

test('react: target="_blank" needs rel="noopener", and noopener alone (keeping the referrer) is enough', async () => {
  const link = (rel) => `export const L = () => <a href="https://example.com" target="_blank"${rel}>x</a>\n`
  assert.deepEqual(await lint(react, link(''), 'src/component/L.jsx'), ['react/jsx-no-target-blank'])
  assert.deepEqual(await lint(react, link(' rel="noopener"'), 'src/component/L.jsx'), [])
})

test('react: the React version is pinned, never detected', () => {
  const versions = react.map((config) => config.settings?.react?.version).filter(Boolean)
  assert.deepEqual(versions, ['19.2'])
})

test('astro + react: React islands lint inside an Astro site', async () => {
  assert.deepEqual(await lint([...astro, ...react], component, 'src/component/Counter.jsx'), [])
  const page = '---\nconst title = "Home"\n---\n<h1>{title}</h1>\n'
  assert.deepEqual(await lint([...astro, ...react], page, 'src/pages/index.astro'), [])
})

test('prettier: single quotes, no semicolons, width 120, LF', async () => {
  const out = await prettier.format('const a = "x";\r\n', { ...prettierConfig, filepath: 'x.js' })
  assert.equal(out, "const a = 'x'\n")
})

test('prettier: formats .astro files through the bundled plugin', async () => {
  const out = await prettier.format('---\nconst a = "x";\n---\n<p>{a}</p>\n', {
    ...prettierConfig,
    filepath: 'x.astro',
  })
  assert.equal(out, "---\nconst a = 'x'\n---\n\n<p>{a}</p>\n")
})
