import { describe, expect, it, vi } from 'vitest'

// The SDK's client is replaced for this whole file, so the mailer's own default client can be checked
// without any chance of a real request: the stand-in records its config and sends nothing.
const built = vi.hoisted(() => [])
vi.mock('@aws-sdk/client-sesv2', async (importOriginal) => ({
  ...(await importOriginal()),
  SESv2Client: class {
    constructor(config) {
      built.push(config)
    }

    async send() {
      return { MessageId: 'stand-in' }
    }
  }
}))

const { createMailer } = await import('../index.js')
const { fakeLogger } = await import('./helpers.js')

const message = { to: 'jane@example.com', subject: 'Road alert', text: 'Ice on M-24.' }
const mailer = (options) => createMailer({ from: 'alerts@thawwatch.com', logger: fakeLogger(), ...options })

describe('the default SES client', () => {
  it('is built on the first send, once, in AWS_REGION or us-east-1', async () => {
    built.length = 0
    const unset = mailer({ env: { EMAIL_PROVIDER: 'ses' } })
    expect(built).toHaveLength(0)
    await unset.send(message)
    await unset.send(message)
    await mailer({ env: { EMAIL_PROVIDER: 'ses', AWS_REGION: 'us-west-2' } }).send(message)
    await mailer({ region: 'eu-west-1', env: { EMAIL_PROVIDER: 'ses', AWS_REGION: 'us-west-2' } }).send(message)
    expect(built.map((c) => c.region)).toEqual(['us-east-1', 'us-west-2', 'eu-west-1'])
  })

  it('is never built in log mode', async () => {
    built.length = 0
    await mailer({ env: {} }).send(message)
    expect(built).toHaveLength(0)
  })

  it('takes credentials from the environment: no keys are passed', async () => {
    built.length = 0
    await mailer({ env: { EMAIL_PROVIDER: 'ses' } }).send(message)
    expect(Object.keys(built[0])).toEqual(['region'])
  })
})
