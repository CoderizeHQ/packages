import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'

import { normalizeMessage } from './message.js'
import { renderRaw } from './mime.js'
import { isTransientAwsError, SendError } from './sendError.js'

const LOG_ONLY = 'EMAIL NOT SENT (log only: set EMAIL_PROVIDER=ses to send)'
const PREVIEW_CHARS = 800

/**
 * The SendEmail input for a normalised message: Simple content, or Raw when there are attachments.
 * @param {import('./message.js').NormalMessage} m
 */
export function sesInput(m) {
  const input = {
    FromEmailAddress: m.from,
    Destination: {
      ToAddresses: m.to,
      ...(m.cc.length ? { CcAddresses: m.cc } : {}),
      // The envelope is the only place Bcc goes, on both paths.
      ...(m.bcc.length ? { BccAddresses: m.bcc } : {})
    },
    ...(m.configurationSet ? { ConfigurationSetName: m.configurationSet } : {})
  }

  if (m.attachments.length) {
    // Reply-To and the custom headers are inside the raw message.
    return { ...input, Content: { Raw: { Data: renderRaw(m) } } }
  }

  return {
    ...input,
    ...(m.replyTo.length ? { ReplyToAddresses: m.replyTo } : {}),
    Content: {
      Simple: {
        Subject: { Data: m.subject, Charset: 'UTF-8' },
        Body: {
          ...(m.text ? { Text: { Data: m.text, Charset: 'UTF-8' } } : {}),
          ...(m.html ? { Html: { Data: m.html, Charset: 'UTF-8' } } : {})
        },
        ...(m.headers.length ? { Headers: m.headers.map(([Name, Value]) => ({ Name, Value })) } : {})
      }
    }
  }
}

/**
 * What an AWS error says, minus anything that names a recipient: SES's MessageRejected quotes addresses,
 * while AccessDenied quotes the ARN that is missing from the IAM policy, which is the part worth keeping.
 * @param {unknown} error
 */
function errorFacts(error) {
  const e = /** @type {any} */ (error)
  return {
    error: e?.name,
    statusCode: e?.$metadata?.httpStatusCode,
    requestId: e?.$metadata?.requestId,
    detail: String(e?.message ?? '')
      .replace(/[^\s<>()[\]"',;:]+@[^\s<>()[\]"',;:]+/g, '[address]')
      .slice(0, 300)
  }
}

/** @param {import('./message.js').NormalMessage} m */
const recipientCount = (m) => m.to.length + m.cc.length + m.bcc.length

/**
 * A mailer for one app. SES only when `EMAIL_PROVIDER` is `ses`; anything else logs the message instead
 * of sending it, at error level in production (where it means mail is not going out) and at info level
 * with a body preview elsewhere.
 *
 * @param {object} [options]
 * @param {string} [options.from] the app's default From, e.g. `process.env.EMAIL_FROM ?? 'App <no-reply@app.com>'`
 * @param {string} [options.configurationSet] SES configuration set to name on every send; none by default
 * @param {{ send: (command: SendEmailCommand) => Promise<{ MessageId?: string }> }} [options.client] an SESv2Client, injected in tests
 * @param {string} [options.region] defaults to `AWS_REGION`, then us-east-1
 * @param {{ info: Function, error: Function }} [options.logger] pino (`app.log`) or console, the default
 * @param {Record<string, string | undefined>} [options.env] defaults to `process.env`; read once, here
 */
export function createMailer({ from, configurationSet, client, region, logger = console, env = process.env } = {}) {
  const enabled = env.EMAIL_PROVIDER === 'ses'
  const production = env.NODE_ENV === 'production'
  let ses = client
  const sesClient = () => (ses ??= new SESv2Client({ region: region || env.AWS_REGION || 'us-east-1' }))
  const defaults = { from, configurationSet }

  /**
   * @param {import('./message.js').NormalMessage} m
   */
  function logOnly(m) {
    if (production) {
      logger.error({ recipients: recipientCount(m), subject: m.subject }, LOG_ONLY)
    } else {
      logger.info(
        {
          to: m.to,
          ...(m.cc.length ? { cc: m.cc } : {}),
          ...(m.bcc.length ? { bcc: m.bcc } : {}),
          subject: m.subject,
          ...(m.attachments.length ? { attachments: m.attachments.map((a) => a.filename) } : {}),
          body: (m.text ?? m.html ?? '').slice(0, PREVIEW_CHARS)
        },
        LOG_ONLY
      )
    }
    return { status: /** @type {const} */ ('logged'), id: null }
  }

  /**
   * Sends one message. Resolves `{ status: 'sent', id }` (id is SES's MessageId), `{ status: 'logged',
   * id: null }` when EMAIL_PROVIDER is not ses, or `{ status: 'skipped', id: null }` when `to` is empty.
   * Throws a SendError when the message did not go out, after logging it.
   * @param {object} message
   */
  async function send(message) {
    let m
    try {
      m = normalizeMessage(message, defaults)
    } catch (err) {
      logger.error({ kind: 'permanent', reason: /** @type {Error} */ (err).message }, 'email not sent')
      throw err
    }
    if (!m) return { status: /** @type {const} */ ('skipped'), id: null }
    if (!enabled) return logOnly(m)

    try {
      const result = await sesClient().send(new SendEmailCommand(sesInput(m)))
      // Production logs carry no addresses (some apps show their logs in an admin viewer); dev keeps them.
      const who = production ? { recipients: recipientCount(m) } : { to: m.to }
      logger.info({ messageId: result.MessageId, ...who, subject: m.subject }, 'email sent')
      return { status: /** @type {const} */ ('sent'), id: result.MessageId ?? null }
    } catch (cause) {
      const kind = isTransientAwsError(cause) ? 'transient' : 'permanent'
      logger.error({ kind, ...errorFacts(cause), recipients: recipientCount(m), subject: m.subject }, 'email not sent')
      throw new SendError('Email not sent', kind, { cause })
    }
  }

  /**
   * `send()` that never throws: `{ ok: true, status, id, error: null }`, or `{ ok: false, status:
   * 'failed', id: null, error }` with the SendError. The failure is already logged.
   * @param {object} message
   */
  async function trySend(message) {
    try {
      return { ok: true, ...(await send(message)), error: null }
    } catch (err) {
      const error = err instanceof SendError ? err : new SendError('Email not sent', 'permanent', { cause: err })
      return { ok: false, status: /** @type {const} */ ('failed'), id: null, error }
    }
  }

  return { mode: enabled ? 'ses' : 'log', send, trySend }
}
