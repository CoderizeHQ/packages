/*
  Cloudflare Turnstile, checked on the server: proof that a real browser submitted a form. Hidden
  fields and "open for 3 seconds" timers are skipped by not sending them, and per-IP limits do nothing
  when every request comes from another address; a challenge token can't be skipped, because its
  absence is the failure.

  Taken from xceptionalheroes-org-mono's lib/turnstile.js, which fails closed. coderize-dev-mono's
  copy failed open (every submission passed while TURNSTILE_SECRET_KEY was unset) and never checked
  the token's action or hostname, so a token solved on any site with the same sitekey passed.

  https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
*/

import { AppError } from './errors.js'

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Cloudflare's own ceiling on a token's length. */
const MAX_TOKEN_LENGTH = 2048

/**
 * @typedef {'NOT_CONFIGURED' | 'MISSING_TOKEN' | 'UNREACHABLE' | 'REJECTED' | 'ACTION_MISMATCH' | 'HOSTNAME_MISMATCH'} TurnstileFailure
 */

/**
 * @typedef {object} TurnstileResult
 * @property {boolean} ok whether Cloudflare vouched for this token, for this form, on this site
 * @property {TurnstileFailure} [reason] why not
 * @property {string[]} [errorCodes] Cloudflare's `error-codes`, when it rejected the token
 */

/**
 * @typedef {object} VerifyTurnstileOptions
 * @property {string} [secret] `TURNSTILE_SECRET_KEY` from the environment by default
 * @property {string} [remoteIp] the client's address (`request.ip`), a signal for Cloudflare
 * @property {string} [action] when given, the token must have been issued for this widget action
 * @property {string | string[]} [hostname] when given, the token must have been solved on this host (or
 *   one of these: list both `example.com` and `www.example.com` if the site answers on both)
 * @property {number} [timeoutMs] 10 seconds by default
 * @property {{ info: Function, warn: Function, error: Function }} [log] e.g. `request.log`. Never given
 *   the token or the secret.
 */

/**
 * Asks Cloudflare whether a Turnstile token is good. Never throws, and fails closed: no secret, no token,
 * Cloudflare unreachable or a non-2xx answer are all `{ ok: false }`, because a verifier that fails open
 * is not a verifier.
 * @param {unknown} token the widget's `cf-turnstile-response` value
 * @param {VerifyTurnstileOptions} [options]
 * @returns {Promise<TurnstileResult>}
 */
export async function verifyTurnstile(token, options = {}) {
  const { secret = process.env.TURNSTILE_SECRET_KEY, remoteIp, action, hostname, timeoutMs = 10_000, log } = options

  if (typeof secret !== 'string' || secret.trim() === '') {
    log?.error('turnstile: TURNSTILE_SECRET_KEY is not set, refusing the submission')
    return { ok: false, reason: 'NOT_CONFIGURED' }
  }
  if (typeof token !== 'string' || token === '' || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: 'MISSING_TOKEN' }
  }

  const body = new URLSearchParams({ secret, response: token })
  if (remoteIp) body.set('remoteip', remoteIp)

  let result
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!response.ok) {
      log?.error({ status: response.status }, 'turnstile: siteverify answered non-2xx')
      return { ok: false, reason: 'UNREACHABLE' }
    }
    result = await response.json()
  } catch (error) {
    log?.error({ error: { name: error?.name, code: error?.code } }, 'turnstile: siteverify request failed')
    return { ok: false, reason: 'UNREACHABLE' }
  }

  if (result?.success !== true) {
    const errorCodes = Array.isArray(result?.['error-codes']) ? result['error-codes'] : []
    log?.info({ errorCodes }, 'turnstile: token rejected')
    return { ok: false, reason: 'REJECTED', errorCodes }
  }
  if (action !== undefined && result.action !== action) {
    log?.warn({ action: result.action, expected: action }, 'turnstile: token issued for another action')
    return { ok: false, reason: 'ACTION_MISMATCH' }
  }
  if (hostname !== undefined) {
    const allowed = (Array.isArray(hostname) ? hostname : [hostname]).map((h) => String(h).toLowerCase())
    if (!allowed.includes(String(result.hostname ?? '').toLowerCase())) {
      log?.warn({ hostname: result.hostname }, 'turnstile: token solved on another site')
      return { ok: false, reason: 'HOSTNAME_MISMATCH' }
    }
  }
  return { ok: true }
}

/**
 * @typedef {object} RequireTurnstileOptions
 * @property {string} [action] the widget action this route's form uses
 * @property {string | string[]} [hostname] the site's host(s)
 * @property {string} [secret] `TURNSTILE_SECRET_KEY` by default, read on every request
 * @property {(request: import('fastify').FastifyRequest) => unknown} [token] where the token is, the
 *   body's `turnstileToken` by default
 * @property {number} [timeoutMs]
 */

/**
 * A preHandler for a public route a bot could profit from (contact forms, sign-ups, anything that sends
 * mail). It throws an `AppError` for the API's error handler to answer:
 *
 * - 403 `CHALLENGE_FAILED` when the token is missing, rejected or for another action or site;
 * - 503 `CHALLENGE_UNAVAILABLE` when the secret is unset or Cloudflare can't be reached, which is
 *   reported to Sentry, because it is ours to fix.
 *
 * ```js
 * app.post('/contact', { preHandler: requireTurnstile({ action: 'contact', hostname: 'example.com' }) }, handler)
 * ```
 * @param {RequireTurnstileOptions} [options]
 */
export function requireTurnstile({ token = (request) => request.body?.turnstileToken, secret, ...rest } = {}) {
  return async function turnstilePreHandler(request) {
    const result = await verifyTurnstile(token(request), {
      ...rest,
      ...(secret !== undefined && { secret }),
      remoteIp: request.ip,
      log: request.log
    })
    if (result.ok) return
    if (result.reason === 'NOT_CONFIGURED' || result.reason === 'UNREACHABLE') {
      throw new AppError('This form is unavailable right now. Please try again later.', 503, 'CHALLENGE_UNAVAILABLE')
    }
    throw new AppError(
      'We could not confirm this came from a browser. Please reload the page and try again.',
      403,
      'CHALLENGE_FAILED'
    )
  }
}
