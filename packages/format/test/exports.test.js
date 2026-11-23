import { readdir, readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const SUBPATHS = {
  csv: ['csvCell', 'toCsv'],
  date: [
    'DEFAULT_TIME_ZONE',
    'addDays',
    'calendarDay',
    'dayRangeUtc',
    'formatDate',
    'formatDateTime',
    'formatRelative',
    'formatTime',
    'todayIn',
    'utcDay',
    'utcToZonedWallTime',
    'zonedParts',
    'zonedWallTimeToUtc',
  ],
  money: ['centsToInput', 'formatCents', 'parseDollarsToCents'],
  phone: [
    'PHONE_STATUS',
    'displayPhone',
    'formatPhone',
    'formatPhoneAsTyped',
    'normalizePhone',
    'phoneForSaving',
    'phoneHref',
    'phoneNeedsFixing',
    'phoneStatus',
    'samePhone',
  ],
  slug: ['slugify'],
}

// Imported by name through the package's own exports map, as an app would.
const MODULES = {
  csv: () => import('@coderizehq/format/csv'),
  date: () => import('@coderizehq/format/date'),
  money: () => import('@coderizehq/format/money'),
  phone: () => import('@coderizehq/format/phone'),
  slug: () => import('@coderizehq/format/slug'),
}

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')
const sorted = (list) => [...list].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))

describe('package exports', () => {
  it.each(Object.entries(SUBPATHS))('serves @coderizehq/format/%s', async (name, expected) => {
    const mod = await MODULES[name]()
    expect(sorted(Object.keys(mod))).toEqual(sorted(expected))
  })

  it.each(Object.entries(SUBPATHS))('declares a type for every runtime export of %s', async (name, expected) => {
    const types = await read(`${name}.d.ts`)
    const declared = [...types.matchAll(/^export declare (?:const|function) (\w+)/gm)].map((m) => m[1])
    expect(sorted(new Set(declared))).toEqual(sorted(expected))
  })

  it('maps each subpath to its module and types, and publishes them', async () => {
    const pkg = JSON.parse(await read('package.json'))
    const modules = (await readdir(new URL('..', import.meta.url))).filter((f) => /\.(js|d\.ts)$/.test(f))
    for (const file of modules.filter((f) => f !== 'vitest.config.js')) expect(pkg.files).toContain(file)
    expect(pkg.files).not.toContain('vitest.config.js')
    for (const name of Object.keys(SUBPATHS)) {
      expect(pkg.exports[`./${name}`]).toEqual({ types: `./${name}.d.ts`, default: `./${name}.js` })
    }
    expect(pkg.exports['.']).toBeUndefined()
  })

  it('has no dependencies and imports nothing, so it runs in a browser, Node and an Astro build', async () => {
    const pkg = JSON.parse(await read('package.json'))
    expect(pkg.dependencies).toBeUndefined()
    expect(pkg.peerDependencies).toBeUndefined()
    for (const name of Object.keys(SUBPATHS)) {
      const source = await read(`${name}.js`)
      expect(source).not.toMatch(/^\s*import\s/m)
      expect(source).not.toMatch(/\brequire\(|\bprocess\.|\bBuffer\b/)
    }
  })
})
