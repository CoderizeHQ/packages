import { readdir, readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const EXPORTS = [
  'FormClientConfigError',
  'HONEYPOT_FIELD',
  'RESERVED_FIELDS',
  'createFormGuard',
  'submitForm',
  'uploadFile'
]

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')
const declared = (types) => [...types.matchAll(/^export declare (?:const|function|class) (\w+)/gm)].map((m) => m[1])

describe('package exports', () => {
  it('serves the framework-free core from the main entry', async () => {
    const pkg = await import('@coderize/form-client')
    expect(Object.keys(pkg).sort()).toEqual(EXPORTS)
  })

  it('serves the React hook from its own entry', async () => {
    const react = await import('@coderize/form-client/react')
    expect(Object.keys(react)).toEqual(['useFormGuard'])
  })

  it('keeps react out of the main entry, so an Astro <script> can use it without React', async () => {
    const modules = (await readdir(new URL('..', import.meta.url))).filter((f) => f.endsWith('.js') && f !== 'react.js')
    for (const file of modules) expect(await read(file), file).not.toMatch(/from 'react'|from '\.\/react\.js'/)
  })

  it('declares a type for every runtime export', async () => {
    expect(declared(await read('index.d.ts')).sort()).toEqual(EXPORTS)
    expect(declared(await read('react.d.ts'))).toEqual(['useFormGuard'])
  })

  it('publishes every module and both type files', async () => {
    const pkg = JSON.parse(await read('package.json'))
    const modules = (await readdir(new URL('..', import.meta.url))).filter((f) => /\.(js|d\.ts)$/.test(f))
    for (const file of modules) expect(pkg.files).toContain(file)
    expect(pkg.exports['.'].types).toBe('./index.d.ts')
    expect(pkg.exports['./react'].types).toBe('./react.d.ts')
  })

  it('keeps react an optional peer', async () => {
    const pkg = JSON.parse(await read('package.json'))
    expect(pkg.peerDependencies.react).toBeDefined()
    expect(pkg.peerDependenciesMeta.react.optional).toBe(true)
    expect(pkg.dependencies).toBeUndefined()
  })
})
