// Type-checked by `tsc -p test/types` in `pnpm test`, as a TypeScript app would import the package.
// Nothing here runs.
import { SESv2Client } from '@aws-sdk/client-sesv2'

import {
  buildRawMessage,
  createMailer,
  esc,
  isTransientAwsError,
  SendError,
  type EmailMessage,
  type SendResult
} from '@coderize/email'
import { confirmSubscription, isSnsUrl, topicRegion, verifySnsMessage, type SnsMessage } from '@coderize/email/sns'

declare const log: { info(obj: object, msg?: string): void; error(obj: object, msg?: string): void }

const mailer = createMailer({
  from: process.env.EMAIL_FROM ?? 'ThawWatch <alerts@thawwatch.com>',
  client: new SESv2Client({ region: 'us-east-1' }),
  logger: log
})
const mode: 'ses' | 'log' = mailer.mode

export async function digest(to: string[], pdf: Buffer): Promise<string | null> {
  const message: EmailMessage = {
    to,
    subject: 'Weekly DMARC digest',
    text: 'Attached.',
    html: `<p>${esc('Acme & Co')}</p>`,
    headers: { 'List-Unsubscribe': '<https://app.dmarc.ws/u>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    attachments: [
      { filename: 'digest.pdf', content: pdf },
      { filename: 'data.csv', content: 'YSxi', contentType: 'text/csv' }
    ]
  }
  const result: SendResult = await mailer.send(message)
  if (result.status === 'sent') return result.id
  // @ts-expect-error a logged send has no id
  const id: string = result.id
  return id
}

export async function reset(to: string): Promise<boolean> {
  const result = await mailer.trySend({ to, subject: 'Reset', text: 'Link' })
  if (!result.ok) {
    const kind: 'transient' | 'permanent' = result.error.kind
    return kind === 'transient'
  }
  return result.status === 'sent'
}

// @ts-expect-error subject is required
mailer.send({ to: 'a@b.com', text: 'x' })
// @ts-expect-error a nested list is not a recipient list
mailer.send({ to: [['a@b.com']], subject: 'x', text: 'x' })

const raw: Buffer = buildRawMessage({ to: 'a@b.com', subject: 'x', text: 'x' }, { from: 'a@b.com' })
const transient: boolean = isTransientAwsError(new Error('x'))
const error = new SendError('Email not sent', 'permanent', { cause: new Error('x') })

export async function snsRoute(body: string): Promise<number> {
  const message = JSON.parse(body) as SnsMessage
  if (!(await verifySnsMessage(message, { topicArn: process.env.SES_SNS_TOPIC_ARN }))) return 403
  if (message.Type === 'SubscriptionConfirmation') {
    const { ok }: { ok: boolean } = await confirmSubscription(message)
    return ok ? 200 : 502
  }
  const region: string | null = topicRegion(message.TopicArn)
  return isSnsUrl(message.SigningCertURL, { region, pem: true }) ? 200 : 403
}

export { error, mode, raw, transient }
