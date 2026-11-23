import { readdir, readFile } from 'node:fs/promises'

import { describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false },
  registerPlugin: () => ({}),
}))

const SUBPATHS = {
  'cloud-save': { file: 'cloudSave', exports: ['createCloudSave'] },
  haptics: { file: 'haptics', exports: ['buzz'] },
}

// Imported by name through the package's own exports map, as a game would.
const MODULES = {
  'cloud-save': () => import('@coderizehq/game-kit/cloud-save'),
  haptics: () => import('@coderizehq/game-kit/haptics'),
}

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')
const declared = (types) => [...types.matchAll(/^export declare (?:const|function|class) (\w+)/gm)].map((m) => m[1])

describe('package exports', () => {
  it.each(Object.entries(SUBPATHS))('serves @coderizehq/game-kit/%s', async (name, { exports }) => {
    expect(Object.keys(await MODULES[name]()).sort()).toEqual(exports)
  })

  it.each(Object.entries(SUBPATHS))(
    'declares a type for every runtime export of %s',
    async (_name, { file, exports }) => {
      expect(declared(await read(`${file}.d.ts`)).sort()).toEqual(exports)
    },
  )

  it('maps each subpath to its module and types, and publishes them', async () => {
    const pkg = JSON.parse(await read('package.json'))
    const modules = (await readdir(new URL('..', import.meta.url))).filter((f) => /\.(js|d\.ts)$/.test(f))
    for (const file of modules) expect(pkg.files).toContain(file)
    for (const [name, { file }] of Object.entries(SUBPATHS)) {
      expect(pkg.exports[`./${name}`]).toEqual({ types: `./${file}.d.ts`, default: `./${file}.js` })
    }
    expect(pkg.exports['.']).toBeUndefined()
  })

  it('needs @capacitor/core from the game, and @capacitor/haptics only for /haptics', async () => {
    const pkg = JSON.parse(await read('package.json'))
    expect(pkg.dependencies).toBeUndefined()
    expect(Object.keys(pkg.peerDependencies).sort()).toEqual(['@capacitor/core', '@capacitor/haptics'])
    expect(pkg.peerDependenciesMeta['@capacitor/haptics'].optional).toBe(true)
    expect(await read('cloudSave.js')).not.toMatch(/@capacitor\/haptics/)
  })
})

// The Android half. A player's existing save is found by the plugin name, the slot name and the
// conflict policy, in all three games; these lines must never change.
describe('the Android plugin', () => {
  const java = () => read('android/src/main/java/dev/coderize/cloudsave/CloudSavePlugin.java')

  it('is shipped where cap sync looks for it', async () => {
    const pkg = JSON.parse(await read('package.json'))
    expect(pkg.capacitor).toEqual({ android: { src: 'android' } })
    expect(pkg.files).toEqual(expect.arrayContaining(['android/build.gradle', 'android/src/main/']))
    expect(await read('android/build.gradle')).toMatch(/namespace = "dev\.coderize\.cloudsave"/)
  })

  it('keeps the plugin name, slot and conflict policy the games save under', async () => {
    const source = await java()
    expect(source).toMatch(/^package dev\.coderize\.cloudsave;$/m)
    expect(source).toContain('@CapacitorPlugin(name = "CloudSave")\npublic class CloudSavePlugin extends Plugin {')
    expect(source).toContain('private static final String SLOT = "progress";')
    const opens = source.match(/\.open\(SLOT, true, SnapshotsClient\.RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED\)/g)
    expect(opens).toHaveLength(2)
    expect(source).not.toMatch(/\.open\((?!SLOT, true, SnapshotsClient\.RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED\))/)
  })

  it('answers the three calls the JavaScript side makes', async () => {
    const methods = [...(await java()).matchAll(/@PluginMethod\s+public void (\w+)\(PluginCall call\)/g)].map(
      (m) => m[1],
    )
    expect(methods).toEqual(['status', 'load', 'save'])
  })

  it('declares play-services-games-v2, taking the version from the game when it sets one', async () => {
    const gradle = await read('android/build.gradle')
    expect(gradle).toContain(
      'implementation "com.google.android.gms:play-services-games-v2:$playServicesGamesV2Version"',
    )
    expect(gradle).toMatch(
      /project\.hasProperty\('playServicesGamesV2Version'\) \? rootProject\.ext\.playServicesGamesV2Version : '22\.1\.0'/,
    )
  })
})
