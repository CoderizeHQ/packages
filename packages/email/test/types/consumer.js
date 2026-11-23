// Type-checked by `tsc -p test/types` in `pnpm test` (checkJs), as an app would import the package: a TypeScript app,
// or JavaScript checked against the package's .d.ts files. Nothing here runs.
import { SESv2Client } from '@aws-sdk/client-sesv2'

import { buildRawMessage, createMailer, esc, isTransientAwsError, SendError } from '@coderizehq/email'
import { confirmSubscription, isSnsUrl, topicRegion, verifySnsMessage } from '@coderizehq/email/sns'

/** @import { EmailMessage, SendResult } from '@coderizehq/email' */
/** @import { SnsMessage } from '@coderizehq/email/sns' */

/** @type {{ info(obj: object, msg?: string): void, error(obj: object, msg?: string): void }} */
const log = { info() {}, error() {} }

const mailer = createMailer({
  from: process.env.EMAIL_FROM ?? 'ThawWatch <alerts@thawwatch.com>',
  client: new SESv2Client({ region: 'us-east-1' }),
  logger: log,
})
/** @type {'ses' | 'log'} */
const mode = mailer.mode

/**
 * @param {string[]} to
 * @param {Buffer} pdf
 * @returns {Promise<string | null>}
 */
export async function digest(to, pdf) {
  /** @type {EmailMessage} */
  const message = {
    to,
    subject: 'Weekly DMARC digest',
    text: 'Attached.',
    html: `<p>${esc('Acme & Co')}</p>`,
    headers: { 'List-Unsubscribe': '<https://app.dmarc.ws/u>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    attachments: [
      { filename: 'digest.pdf', content: pdf },
      { filename: 'data.csv', content: 'YSxi', contentType: 'text/csv' },
    ],
  }
  /** @type {SendResult} */
  const result = await mailer.send(message)
  if (result.status === 'sent') return result.id
  // @ts-expect-error a logged send has no id
  const id = /** @type {string} */ (result.id)
  return id
}

/**
 * @param {string} to
 * @returns {Promise<boolean>}
 */
export async function reset(to) {
  const result = await mailer.trySend({ to, subject: 'Reset', text: 'Link' })
  if (!result.ok) {
    /** @type {'transient' | 'permanent'} */
    const kind = result.error.kind
    return kind === 'transient'
  }
  return result.status === 'sent'
}

// @ts-expect-error subject is required
mailer.send({ to: 'a@b.com', text: 'x' })
// @ts-expect-error a nested list is not a recipient list
mailer.send({ to: [['a@b.com']], subject: 'x', text: 'x' })

/** @type {Buffer} */
const raw = buildRawMessage({ to: 'a@b.com', subject: 'x', text: 'x' }, { from: 'a@b.com' })
/** @type {boolean} */
const transient = isTransientAwsError(new Error('x'))
const error = new SendError('Email not sent', 'permanent', { cause: new Error('x') })

/**
 * @param {string} body
 * @returns {Promise<number>}
 */
export async function snsRoute(body) {
  /** @type {SnsMessage} */
  const message = JSON.parse(body)
  if (!(await verifySnsMessage(message, { topicArn: process.env.SES_SNS_TOPIC_ARN }))) return 403
  if (message.Type === 'SubscriptionConfirmation') {
    /** @type {{ ok: boolean }} */
    const { ok } = await confirmSubscription(message)
    return ok ? 200 : 502
  }
  /** @type {string | null} */
  const region = topicRegion(message.TopicArn)
  return isSnsUrl(message.SigningCertURL, { region, pem: true }) ? 200 : 403
}

export { error, mode, raw, transient }
