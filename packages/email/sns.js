/*
  Amazon SNS message signatures, for the route that receives SES bounce, complaint and delivery
  notices (or inbound mail) over an SNS HTTPS subscription. Ported from xceptionalheroes-org-mono's
  lib/snsVerify.js, with the SubscribeURL rule from coderize-dev-mono #410 and gronetworking #207.

  SNS signs every message it POSTs to an HTTPS subscription, and anyone on the internet can POST to that
  URL, so nothing in a message is trusted until its signature checks out against the certificate SNS
  publishes. The steps are AWS's own ("Verifying the signatures of Amazon SNS messages"):

    1. The certificate URL must be HTTPS on exactly sns.<region>.amazonaws.com, with the region taken
       from the message's own TopicArn, and end in .pem, or an attacker could point us at a certificate
       of their own. A pattern like sns.<anything>.amazonaws.com is not enough: sns.s3.amazonaws.com is
       an S3 bucket hostname anyone could have created, and gronetworking and coderize-dev both accepted
       it until November 2026. A subscription message's SubscribeURL is held to the same rule, since the
       API makes a request to it.
    2. Build the string SNS signed: the message's fields in a fixed order, each "Name\nvalue\n".
       Notifications and subscription messages sign different fields.
    3. Verify the base64 Signature over that string with the certificate's public key: SHA1withRSA for
       SignatureVersion 1, SHA256withRSA for 2.

  Certificates are cached by URL, at most 20, until they expire: SNS signs with the same one for months.
  This module has no AWS SDK or Fastify dependency, so a Lambda can use it as well as an API.
*/
import { createVerify, X509Certificate } from 'node:crypto'

const REGION = /^[a-z]{2}(-[a-z]+)+-\d$/
const FIELDS = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
}
const ALGORITHM = { 1: 'RSA-SHA1', 2: 'RSA-SHA256' }
const TIMEOUT_MS = 5000
const MAX_CERTS = 20

/**
 * The AWS region in an SNS topic ARN (`arn:aws:sns:<region>:<account>:<name>`), or null.
 * @param {unknown} topicArn
 * @returns {string | null}
 */
export function topicRegion(topicArn) {
  const region = String(topicArn ?? '').split(':')[3] ?? ''
  return REGION.test(region) ? region : null
}

/**
 * Whether a SigningCertURL (`pem: true`) or SubscribeURL is on the SNS endpoint of `region`: HTTPS, host
 * exactly `sns.<region>.amazonaws.com`, no port, no credentials.
 * @param {unknown} url
 * @param {{ region?: string | null, pem?: boolean }} [options]
 * @returns {boolean}
 */
export function isSnsUrl(url, { region, pem = false } = {}) {
  if (!region || !REGION.test(region)) return false
  let u
  try {
    u = new URL(String(url))
  } catch {
    return false
  }
  return (
    u.protocol === 'https:' &&
    u.hostname === `sns.${region}.amazonaws.com` &&
    !u.username &&
    !u.password &&
    !u.port &&
    (!pem || u.pathname.endsWith('.pem'))
  )
}

/**
 * The exact string SNS signed for this message, or null for a type it does not sign or a message
 * missing a signed field.
 * @param {Record<string, unknown> | null | undefined} message
 * @returns {string | null}
 */
export function signingString(message) {
  const fields = FIELDS[/** @type {keyof typeof FIELDS} */ (message?.Type)]
  if (!fields || !message) return null
  let out = ''
  for (const name of fields) {
    const value = message[name]
    // Subject is optional on a notification and left out of the string when absent.
    if (value === undefined || value === null) {
      if (name === 'Subject') continue
      return null
    }
    out += `${name}\n${value}\n`
  }
  return out
}

/** @type {Map<string, { key: import('node:crypto').KeyObject, validTo: number }>} */
const certs = new Map()

/**
 * Fetches the signing certificate and returns its public key, from the cache when it has it. Throws
 * unless the response is a currently valid X.509 certificate. Redirects are refused: the host check is
 * only worth anything if that host is the one that answers.
 * @param {string} url
 * @param {{ fetch?: typeof fetch }} [options] `fetch` is injectable for tests
 * @returns {Promise<import('node:crypto').KeyObject>}
 */
export async function fetchSigningCert(url, { fetch: fetchImpl = fetch } = {}) {
  const hit = certs.get(url)
  if (hit && hit.validTo > Date.now()) return hit.key
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' })
  if (!res.ok) throw new Error(`SNS certificate fetch failed: HTTP ${res.status}`)
  const cert = new X509Certificate(await res.text())
  const validTo = new Date(cert.validTo).getTime()
  if (!(validTo > Date.now()) || new Date(cert.validFrom).getTime() > Date.now()) {
    throw new Error('SNS signing certificate is not currently valid')
  }
  const key = cert.publicKey
  if (certs.size >= MAX_CERTS) certs.delete(/** @type {string} */ (certs.keys().next().value))
  certs.set(url, { key, validTo })
  return key
}

/**
 * Whether an SNS message is genuinely from SNS (and, given `topicArn`, from that topic). Never throws:
 * a bad host, a failed certificate fetch, an unknown SignatureVersion and a bad signature are all false.
 *
 * Pin `topicArn` to the topic the app subscribed to. Without it, any SNS topic in any account can deliver
 * a validly signed message to the route.
 * @param {unknown} message the parsed JSON body SNS posted (it arrives as text/plain)
 * @param {object} [options]
 * @param {string | string[]} [options.topicArn] the topic(s) this route accepts
 * @param {(url: string) => Promise<import('node:crypto').KeyObject | string>} [options.fetchCert] replaces the certificate download in tests
 * @returns {Promise<boolean>}
 */
export async function verifySnsMessage(message, { topicArn, fetchCert = fetchSigningCert } = {}) {
  try {
    const m = /** @type {Record<string, any>} */ (message)
    const algorithm = ALGORITHM[/** @type {1 | 2} */ (m?.SignatureVersion)]
    if (!algorithm || typeof m.Signature !== 'string') return false
    if (topicArn !== undefined && ![topicArn].flat().includes(m.TopicArn)) return false
    const region = topicRegion(m.TopicArn)
    if (!isSnsUrl(m.SigningCertURL, { region, pem: true })) return false
    if (m.Type !== 'Notification' && !isSnsUrl(m.SubscribeURL, { region })) return false
    const signed = signingString(m)
    if (!signed) return false
    const key = await fetchCert(m.SigningCertURL)
    return createVerify(algorithm).update(signed, 'utf8').verify(key, m.Signature, 'base64')
  } catch {
    return false
  }
}

/**
 * Confirms a subscription: GETs the SubscribeURL of a SubscriptionConfirmation that has already passed
 * `verifySnsMessage`. The URL is checked again here (exactly the SNS endpoint of the topic's region), and
 * the request refuses redirects and gives up after 5 seconds. Throws when the URL fails the check;
 * resolves the response status otherwise.
 * @param {Record<string, any>} message
 * @param {{ fetch?: typeof fetch }} [options] `fetch` is injectable for tests
 * @returns {Promise<{ ok: boolean, status: number }>}
 */
export async function confirmSubscription(message, { fetch: fetchImpl = fetch } = {}) {
  if (message?.Type !== 'SubscriptionConfirmation') {
    throw new Error('confirmSubscription: not a SubscriptionConfirmation message')
  }
  if (!isSnsUrl(message.SubscribeURL, { region: topicRegion(message.TopicArn) })) {
    throw new Error('confirmSubscription: SubscribeURL is not the SNS endpoint of the topic region')
  }
  const res = await fetchImpl(message.SubscribeURL, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' })
  return { ok: res.ok, status: res.status }
}
