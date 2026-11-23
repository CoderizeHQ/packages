/**
 * What `send()` throws when a message did not go out. `kind` tells the caller what to do about it:
 *
 * - `transient`: throttling, an SES 5xx or a network failure. Worth trying again later.
 * - `permanent`: anything else (AccessDenied, an unverified identity, a message this package refused to
 *   build). Retrying the same message won't help.
 *
 * The message never quotes an address or any content. A failed SES call says `Email not sent` and keeps
 * the AWS error as `cause`; a message refused before sending says why (`Email not sent: subject is
 * required`).
 */
export class SendError extends Error {
  /**
   * @param {string} message
   * @param {'transient' | 'permanent'} kind
   * @param {{ cause?: unknown }} [options]
   */
  constructor(message, kind, options) {
    super(message, options)
    this.name = 'SendError'
    this.kind = kind
  }
}

const TRANSIENT_NAMES = new Set([
  'ThrottlingException',
  'TooManyRequestsException',
  'LimitExceededException',
  'InternalServerException',
  'InternalFailure',
  'ServiceUnavailable',
  'RequestTimeout',
  'TimeoutError'
])

/**
 * Whether an AWS SDK v3 error is worth retrying: the SDK marked it retryable, its name is a throttle or a
 * server fault, SES answered 5xx, or there was no answer at all. An SDK error carries `$metadata` from
 * the service, so one without it never reached SES (DNS, a reset connection, a timeout).
 *
 * Shared with SMS senders (SNS, End User Messaging), which fail the same ways.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isTransientAwsError(error) {
  const e = /** @type {any} */ (error)
  if (e?.$retryable) return true
  if (TRANSIENT_NAMES.has(e?.name)) return true
  if (e?.$metadata?.httpStatusCode >= 500) return true
  return !e?.$metadata && !e?.$fault
}
