import { SendEmailCommand } from '@aws-sdk/client-sesv2'
import { describe, expect, it } from 'vitest'

import { createMailer, SendError } from '../index.js'
import { awsError, fakeLogger, fakeSes, fixture, SES_ENV } from './helpers.js'

const FROM = 'ThawWatch <alerts@thawwatch.com>'
const message = (extra = {}) => ({ to: 'jane@example.com', subject: 'Road alert', text: 'Ice on M-24.', ...extra })

function sesMailer(options = {}) {
  const client = fakeSes(options.respond)
  const logger = fakeLogger()
  const mailer = createMailer({ from: FROM, client, logger, env: SES_ENV, ...options })
  return { mailer, client, logger }
}

describe('the EMAIL_PROVIDER switch', () => {
  it('sends through SES only when EMAIL_PROVIDER is ses', async () => {
    const { mailer, client } = sesMailer()
    expect(mailer.mode).toBe('ses')
    expect(await mailer.send(message())).toEqual({ status: 'sent', id: 'ses-message-1' })
    expect(client.send).toHaveBeenCalledOnce()
    expect(client.send.mock.calls[0][0]).toBeInstanceOf(SendEmailCommand)
  })

  it.each([{}, { EMAIL_PROVIDER: 'SES' }, { EMAIL_PROVIDER: 'resend' }, { EMAIL_ENABLED: '1' }])(
    'logs instead of sending for env %j, and says so in the result',
    async (env) => {
      const client = fakeSes()
      const mailer = createMailer({ from: FROM, client, logger: fakeLogger(), env })
      expect(mailer.mode).toBe('log')
      expect(await mailer.send(message())).toEqual({ status: 'logged', id: null })
      expect(client.send).not.toHaveBeenCalled()
    }
  )

  it('logs at error level in production, with no recipient address and no body', async () => {
    const logger = fakeLogger()
    const mailer = createMailer({ from: FROM, logger, env: { NODE_ENV: 'production' } })
    await mailer.send(message({ html: '<p>Ice on M-24.</p>' }))
    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledOnce()
    const [fields, text] = logger.error.mock.calls[0]
    expect(text).toMatch(/EMAIL NOT SENT/)
    expect(fields).toEqual({ recipients: 1, subject: 'Road alert' })
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/jane@|Ice on/)
  })

  it('logs a sent message with a recipient count in production, and the addresses only elsewhere', async () => {
    const { mailer, logger } = sesMailer()
    await mailer.send(message({ cc: 'sam@example.com' }))
    expect(logger.info.mock.calls[0]).toEqual([
      { messageId: 'ses-message-1', recipients: 2, subject: 'Road alert' },
      'email sent'
    ])
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/@example/)

    const dev = sesMailer({ env: { EMAIL_PROVIDER: 'ses' } })
    await dev.mailer.send(message())
    expect(dev.logger.info.mock.calls[0][0]).toMatchObject({ to: ['jane@example.com'] })
  })

  it('logs at info level elsewhere, with at most 800 characters of the body', async () => {
    const logger = fakeLogger()
    const mailer = createMailer({ from: FROM, logger, env: {} })
    await mailer.send(message({ text: 'x'.repeat(5000) }))
    expect(logger.error).not.toHaveBeenCalled()
    const [fields] = logger.info.mock.calls[0]
    expect(fields.to).toEqual(['jane@example.com'])
    expect(fields.body).toHaveLength(800)
  })

  it('reads env once, when the mailer is created', async () => {
    const env = { EMAIL_PROVIDER: 'ses' }
    const { mailer, client } = sesMailer({ env })
    env.EMAIL_PROVIDER = 'log'
    await mailer.send(message())
    expect(client.send).toHaveBeenCalledOnce()
  })

  it('never builds a real SES client in log mode', async () => {
    // No client injected: building one would need the SDK's credential chain.
    const mailer = createMailer({ from: FROM, logger: fakeLogger(), env: {} })
    expect(await mailer.send(message())).toEqual({ status: 'logged', id: null })
  })
})

describe('recipients', () => {
  it.each([undefined, null, '', [], [null, '']])('skips the send when to is %j', async (to) => {
    const { mailer, client, logger } = sesMailer()
    expect(await mailer.send(message({ to }))).toEqual({ status: 'skipped', id: null })
    expect(client.send).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('takes to as one address or a flat list', async () => {
    const { mailer, client } = sesMailer()
    await mailer.send(message({ to: 'a@example.com' }))
    expect(client.input().Destination.ToAddresses).toEqual(['a@example.com'])
    await mailer.send(message({ to: ['a@example.com', 'Bea <b@example.com>'] }))
    expect(client.input().Destination.ToAddresses).toEqual(['a@example.com', 'Bea <b@example.com>'])
  })

  it('refuses a nested list rather than sending to nobody', async () => {
    const { mailer, client } = sesMailer()
    await expect(mailer.send(message({ to: [['a@example.com', 'b@example.com']] }))).rejects.toMatchObject({
      name: 'SendError',
      kind: 'permanent',
      message: expect.stringMatching(/nested list/)
    })
    expect(client.send).not.toHaveBeenCalled()
  })

  it('puts cc and bcc in the envelope, and replyTo in ReplyToAddresses', async () => {
    const { mailer, client } = sesMailer()
    await mailer.send(
      message({ cc: 'c@example.com', bcc: ['archive@example.com'], replyTo: 'Help <help@thawwatch.com>' })
    )
    expect(client.input()).toMatchObject({
      Destination: {
        ToAddresses: ['jane@example.com'],
        CcAddresses: ['c@example.com'],
        BccAddresses: ['archive@example.com']
      },
      ReplyToAddresses: ['Help <help@thawwatch.com>']
    })
  })
})

describe('from', () => {
  it('uses the mailer default, and a per-call from overrides it', async () => {
    const { mailer, client } = sesMailer()
    await mailer.send(message())
    expect(client.input().FromEmailAddress).toBe(FROM)
    await mailer.send(message({ from: 'DMARC.WS <noreply@dmarc.ws>' }))
    expect(client.input().FromEmailAddress).toBe('"DMARC.WS" <noreply@dmarc.ws>')
  })

  it('refuses a send with no from anywhere', async () => {
    const { mailer } = sesMailer({ from: undefined })
    await expect(mailer.send(message())).rejects.toThrow(/no from address/)
  })

  it('encodes a non-ASCII display name, as SES requires', async () => {
    const { mailer, client } = sesMailer({ from: 'Café Lapeer <hello@example.com>' })
    await mailer.send(message())
    expect(client.input().FromEmailAddress).toBe(
      `=?UTF-8?B?${Buffer.from('Café Lapeer').toString('base64')}?= <hello@example.com>`
    )
  })
})

describe('the Simple path', () => {
  it('sends text and html as UTF-8 Simple content', async () => {
    const { mailer, client } = sesMailer()
    await mailer.send(message({ subject: 'Glace sur la route', html: '<p>Ice</p>' }))
    expect(client.input().Content).toEqual({
      Simple: {
        Subject: { Data: 'Glace sur la route', Charset: 'UTF-8' },
        Body: { Text: { Data: 'Ice on M-24.', Charset: 'UTF-8' }, Html: { Data: '<p>Ice</p>', Charset: 'UTF-8' } }
      }
    })
  })

  it('carries custom headers, such as the RFC 8058 one-click unsubscribe pair', async () => {
    const { mailer, client } = sesMailer()
    await mailer.send(
      message({
        headers: {
          'List-Unsubscribe': '<https://app.dmarc.ws/unsub?t=abc>, <mailto:unsub@dmarc.ws>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        }
      })
    )
    expect(client.input().Content.Simple.Headers).toEqual([
      { Name: 'List-Unsubscribe', Value: '<https://app.dmarc.ws/unsub?t=abc>, <mailto:unsub@dmarc.ws>' },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' }
    ])
  })

  it('folds a line break in the subject into a space', async () => {
    const { mailer, client } = sesMailer()
    await mailer.send(message({ subject: 'Invite from Acme\r\nBcc: evil@example.com' }))
    expect(client.input().Content.Simple.Subject.Data).toBe('Invite from Acme Bcc: evil@example.com')
  })
})

describe('the Raw path', () => {
  it('goes Raw when there are attachments, with Bcc in the envelope only', async () => {
    const { mailer, client } = sesMailer()
    await mailer.send(
      message({
        bcc: 'archive@example.com',
        replyTo: 'help@thawwatch.com',
        attachments: [{ filename: 'report.pdf', content: fixture('sample.pdf') }]
      })
    )
    const input = client.input()
    expect(input.Content.Simple).toBeUndefined()
    expect(input.ReplyToAddresses).toBeUndefined()
    expect(input.Destination.BccAddresses).toEqual(['archive@example.com'])
    const raw = Buffer.from(input.Content.Raw.Data).toString()
    expect(raw).toMatch(/^Reply-To: help@thawwatch\.com\r$/m)
    expect(raw).not.toMatch(/archive@example\.com/)
  })
})

describe('configuration set', () => {
  it('names none by default, so the identity default set applies', async () => {
    const { mailer, client } = sesMailer()
    await mailer.send(message())
    expect(client.input()).not.toHaveProperty('ConfigurationSetName')
  })

  it('names the mailer set, and a per-call set overrides it', async () => {
    const { mailer, client } = sesMailer({ configurationSet: 'coderize-portal' })
    await mailer.send(message())
    expect(client.input().ConfigurationSetName).toBe('coderize-portal')
    await mailer.send(message({ configurationSet: 'gronetworking' }))
    expect(client.input().ConfigurationSetName).toBe('gronetworking')
  })
})

describe('failures', () => {
  it('throws a transient SendError for a throttle, keeping the AWS error as cause', async () => {
    const cause = awsError('TooManyRequestsException', { status: 429 })
    const { mailer } = sesMailer({ respond: async () => Promise.reject(cause) })
    const error = await mailer.send(message()).catch((e) => e)
    expect(error).toBeInstanceOf(SendError)
    expect(error).toMatchObject({ kind: 'transient', message: 'Email not sent', cause })
  })

  it('throws a permanent SendError for AccessDenied and logs what IAM is missing, not who it was for', async () => {
    const cause = awsError('AccessDeniedException', {
      status: 403,
      message:
        'User arn:aws:sts::651706755822:assumed-role/coderize-apps-v3-instance is not authorized to perform ses:SendEmail on resource arn:aws:ses:us-east-1:651706755822:configuration-set/coderize-default'
    })
    const { mailer, logger } = sesMailer({ respond: async () => Promise.reject(cause) })
    await expect(mailer.send(message())).rejects.toMatchObject({ kind: 'permanent' })
    const [fields, text] = logger.error.mock.calls[0]
    expect(text).toBe('email not sent')
    expect(fields).toMatchObject({
      kind: 'permanent',
      error: 'AccessDeniedException',
      statusCode: 403,
      requestId: 'req-123',
      recipients: 1,
      detail: expect.stringContaining('configuration-set/coderize-default')
    })
    expect(fields).not.toHaveProperty('err')
    expect(JSON.stringify(fields)).not.toMatch(/jane@/)
  })

  it('keeps addresses out of the logged AWS message', async () => {
    const cause = awsError('MessageRejected', {
      message:
        'Email address is not verified. The following identities failed the check in region US-EAST-1: jane@example.com'
    })
    const { mailer, logger } = sesMailer({ respond: async () => Promise.reject(cause) })
    await expect(mailer.send(message())).rejects.toBeInstanceOf(SendError)
    expect(logger.error.mock.calls[0][0].detail).toMatch(/US-EAST-1: \[address\]$/)
  })

  it('logs a refused message at error level too, without its content', async () => {
    const { mailer, logger } = sesMailer()
    await expect(mailer.send(message({ subject: '' }))).rejects.toMatchObject({ kind: 'permanent' })
    expect(logger.error).toHaveBeenCalledWith(
      { kind: 'permanent', reason: 'Email not sent: subject is required' },
      'email not sent'
    )
  })
})

describe('trySend', () => {
  it('resolves ok with the id when the message went out', async () => {
    const { mailer } = sesMailer()
    expect(await mailer.trySend(message())).toEqual({ ok: true, status: 'sent', id: 'ses-message-1', error: null })
  })

  it('resolves ok: true for logged and skipped sends too, with the status saying which', async () => {
    const mailer = createMailer({ from: FROM, logger: fakeLogger(), env: {} })
    expect(await mailer.trySend(message())).toEqual({ ok: true, status: 'logged', id: null, error: null })
    expect(await mailer.trySend(message({ to: [] }))).toEqual({ ok: true, status: 'skipped', id: null, error: null })
  })

  it('never throws: an SES failure or a refused message resolves ok: false with the SendError', async () => {
    const { mailer } = sesMailer({ respond: async () => Promise.reject(awsError('InternalFailure', { status: 500 })) })
    const failed = await mailer.trySend(message())
    expect(failed).toMatchObject({
      ok: false,
      status: 'failed',
      id: null,
      error: { name: 'SendError', kind: 'transient' }
    })
    const refused = await mailer.trySend(null)
    expect(refused).toMatchObject({ ok: false, error: { kind: 'permanent' } })
  })
})
