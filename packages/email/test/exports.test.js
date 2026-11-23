import { readdir, readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const MAIN = ['SendError', 'buildRawMessage', 'createMailer', 'esc', 'isTransientAwsError']
const SNS = ['confirmSubscription', 'fetchSigningCert', 'isSnsUrl', 'signingString', 'topicRegion', 'verifySnsMessage']

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')
const declared = (types) =>
  [...types.matchAll(/^export declare (?:const|function|class) (\w+)/gm)].map((m) => m[1]).sort()

describe('package exports', () => {
  it('serves the mailer from the main entry', async () => {
    const pkg = await import('@coderize/email')
    expect(Object.keys(pkg).sort()).toEqual(MAIN)
  })

  it('serves the SNS verifier from @coderize/email/sns', async () => {
    const sns = await import('@coderize/email/sns')
    expect(Object.keys(sns).sort()).toEqual(SNS)
  })

  it('declares a type for every runtime export', async () => {
    expect(declared(await read('index.d.ts'))).toEqual(MAIN)
    expect(declared(await read('sns.d.ts'))).toEqual(SNS)
  })

  it('publishes every module and both type files', async () => {
    const pkg = JSON.parse(await read('package.json'))
    const modules = (await readdir(new URL('..', import.meta.url))).filter((f) => /\.(js|d\.ts)$/.test(f))
    for (const file of modules) expect(pkg.files).toContain(file)
    expect(pkg.exports['.'].types).toBe('./index.d.ts')
    expect(pkg.exports['./sns'].types).toBe('./sns.d.ts')
  })

  it('keeps the SES SDK a peer, so each app keeps the one copy it already has', async () => {
    const pkg = JSON.parse(await read('package.json'))
    expect(pkg.peerDependencies['@aws-sdk/client-sesv2']).toMatch(/^\^3\./)
    expect(pkg.dependencies).toBeUndefined()
  })

  it('never imports nodemailer', async () => {
    const modules = (await readdir(new URL('..', import.meta.url))).filter((f) => f.endsWith('.js'))
    for (const file of modules) expect(await read(file)).not.toMatch(/nodemailer/)
  })
})
