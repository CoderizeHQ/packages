import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ESLint } from 'eslint'
import * as prettier from 'prettier'
import { astro, node } from '../eslint.js'
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
