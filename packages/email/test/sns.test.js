import { createSign, generateKeyPairSync, sign as signBytes } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  confirmSubscription,
  fetchSigningCert,
  isSnsUrl,
  signingString,
  topicRegion,
  verifySnsMessage
} from '@coderize/email/sns'

const TOPIC = 'arn:aws:sns:us-east-1:123456789012:coderize-ses-events'
const US_EAST_1 = { region: 'us-east-1', pem: true }
const CERT_URL = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc123.pem'
// The bypass the host rule exists to stop: an S3 bucket called "sns" answers on this host, and anyone
// can create it and serve a certificate of their own there.
const S3_CERT_URL = 'https://sns.s3.amazonaws.com/SimpleNotificationService-abc123.pem'
const SUBSCRIBE_URL = 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=x&Token=tok'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })

function sign(message, version = '2', key = privateKey) {
  const signer = createSign(version === '1' ? 'RSA-SHA1' : 'RSA-SHA256')
  signer.update(signingString(message), 'utf8')
  return { ...message, SignatureVersion: version, Signature: signer.sign(key, 'base64') }
}

const notification = (overrides = {}) => ({
  Type: 'Notification',
  MessageId: 'sns-1',
  TopicArn: TOPIC,
  Message: '{"eventType":"Bounce","mail":{"messageId":"msg-1"}}',
  Timestamp: '2026-11-03T12:00:00.000Z',
  SigningCertURL: CERT_URL,
  ...overrides
})

const confirmation = (overrides = {}) => ({
  Type: 'SubscriptionConfirmation',
  MessageId: 'sns-2',
  TopicArn: TOPIC,
  Token: 'tok',
  Message: 'You have chosen to subscribe to the topic',
  SubscribeURL: SUBSCRIBE_URL,
  Timestamp: '2026-11-03T12:00:00.000Z',
  SigningCertURL: CERT_URL,
  ...overrides
})

function certFetcher() {
  const fetchCert = vi.fn(async () => publicKey)
  return { fetchCert, calls: fetchCert.mock.calls }
}

/**
 * A self-signed X.509 certificate for `key`, DER-encoded by hand: node:crypto reads certificates but
 * can't make them, and a test fixture would mean committing a private key.
 */
function makeCertificate({ notBefore, notAfter }) {
  const length = (n) => (n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff])
  const tlv = (tag, ...parts) => {
    const body = Buffer.concat(parts)
    return Buffer.concat([Buffer.from([tag, ...length(body.length)]), body])
  }
  const seq = (...parts) => tlv(0x30, ...parts)
  const oid = (...bytes) => tlv(0x06, Buffer.from(bytes))
  const time = (date) => tlv(0x18, Buffer.from(`${date.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`))
  const name = seq(tlv(0x31, seq(oid(0x55, 0x04, 0x03), tlv(0x0c, Buffer.from('sns.amazonaws.com')))))
  const sha256WithRsa = seq(oid(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b), tlv(0x05))
  const tbs = seq(
    tlv(0xa0, tlv(0x02, Buffer.from([2]))),
    tlv(0x02, Buffer.from([1])),
    sha256WithRsa,
    name,
    seq(time(notBefore), time(notAfter)),
    name,
    publicKey.export({ type: 'spki', format: 'der' })
  )
  const der = seq(tbs, sha256WithRsa, tlv(0x03, Buffer.from([0]), signBytes('sha256', tbs, privateKey)))
  return `-----BEGIN CERTIFICATE-----\n${der.toString('base64').replace(/.{64}/g, '$&\n')}\n-----END CERTIFICATE-----\n`
}

const DAY = 24 * 60 * 60 * 1000
const validPem = makeCertificate({ notBefore: new Date(Date.now() - DAY), notAfter: new Date(Date.now() + 365 * DAY) })

/** A fetch stand-in that serves `body` and records every call. */
function fakeFetch(body, { status = 200 } = {}) {
  return vi.fn(async () => ({ ok: status < 400, status, text: async () => body }))
}

describe('the host rule', () => {
  it('rejects sns.s3.amazonaws.com, an S3 bucket host anyone could own', () => {
    expect(isSnsUrl(S3_CERT_URL, US_EAST_1)).toBe(false)
    // Even if the forger also writes the TopicArn, "s3" is not a region.
    expect(isSnsUrl(S3_CERT_URL, { region: 's3', pem: true })).toBe(false)
    expect(topicRegion('arn:aws:sns:s3:123456789012:x')).toBeNull()
  })

  it('accepts only the SNS host of the topic region', () => {
    expect(topicRegion(TOPIC)).toBe('us-east-1')
    expect(isSnsUrl(CERT_URL, US_EAST_1)).toBe(true)
    expect(isSnsUrl('https://sns.us-west-2.amazonaws.com/SimpleNotificationService-abc123.pem', US_EAST_1)).toBe(false)
  })

  it.each([
    'http://sns.us-east-1.amazonaws.com/a.pem',
    'https://sns.us-east-1.amazonaws.com:8443/a.pem',
    'https://user@sns.us-east-1.amazonaws.com/a.pem',
    'https://user:pw@sns.us-east-1.amazonaws.com/a.pem',
    'https://sns.us-east-1.amazonaws.com.evil.example/a.pem',
    'https://evil.example/sns.us-east-1.amazonaws.com/a.pem',
    'https://sns.cn-north-1.amazonaws.com.cn/a.pem',
    'https://sns.us-east-1.amazonaws.com/a.txt',
    'not a url'
  ])('rejects the look-alike %s', (url) => {
    expect(isSnsUrl(url, US_EAST_1)).toBe(false)
  })

  it('matches nothing without a region', () => {
    expect(isSnsUrl(CERT_URL, { pem: true })).toBe(false)
    expect(isSnsUrl(CERT_URL, { region: null, pem: true })).toBe(false)
  })
})

describe('signingString', () => {
  it('signs the notification fields in order, leaving out an absent Subject', () => {
    expect(signingString(notification())).toBe(
      'Message\n{"eventType":"Bounce","mail":{"messageId":"msg-1"}}\nMessageId\nsns-1\n' +
        `Timestamp\n2026-11-03T12:00:00.000Z\nTopicArn\n${TOPIC}\nType\nNotification\n`
    )
    expect(signingString(notification({ Subject: 'Amazon SES Email Event Notification' }))).toContain(
      'Subject\nAmazon SES Email Event Notification\nTimestamp'
    )
  })

  it('returns null for an unsigned type or a missing field', () => {
    expect(signingString({ ...notification(), Type: 'Other' })).toBeNull()
    expect(signingString(confirmation({ Token: undefined }))).toBeNull()
    expect(signingString(null)).toBeNull()
  })
})

describe('verifySnsMessage', () => {
  it('accepts a message signed for the topic region (SignatureVersion 1 and 2)', async () => {
    const { fetchCert } = certFetcher()
    expect(await verifySnsMessage(sign(notification(), '1'), { fetchCert })).toBe(true)
    expect(await verifySnsMessage(sign(notification(), '2'), { fetchCert })).toBe(true)
    expect(await verifySnsMessage(sign(confirmation()), { fetchCert })).toBe(true)
  })

  it('refuses a certificate on sns.s3.amazonaws.com before fetching anything', async () => {
    const { fetchCert, calls } = certFetcher()
    // Correctly signed with the forger's key, which is what their bucket would serve.
    expect(await verifySnsMessage(sign(notification({ SigningCertURL: S3_CERT_URL })), { fetchCert })).toBe(false)
    expect(calls).toEqual([])
  })

  it('refuses a certificate for a different region than the topic', async () => {
    const { fetchCert, calls } = certFetcher()
    const message = sign(
      notification({ SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc123.pem' })
    )
    expect(await verifySnsMessage(message, { fetchCert })).toBe(false)
    expect(calls).toEqual([])
  })

  it('refuses a subscription message whose SubscribeURL is off the topic region endpoint', async () => {
    const { fetchCert, calls } = certFetcher()
    for (const SubscribeURL of [
      'https://sns.s3.amazonaws.com/?Action=ConfirmSubscription&Token=tok',
      'https://sns.us-west-2.amazonaws.com/?Action=ConfirmSubscription&Token=tok',
      'http://169.254.169.254/latest/meta-data/'
    ]) {
      expect(await verifySnsMessage(sign(confirmation({ SubscribeURL })), { fetchCert }), SubscribeURL).toBe(false)
    }
    expect(calls).toEqual([])
  })

  it('refuses a tampered message, a different key and an unknown SignatureVersion', async () => {
    const { fetchCert } = certFetcher()
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    expect(await verifySnsMessage({ ...sign(notification()), Message: '{}' }, { fetchCert })).toBe(false)
    expect(await verifySnsMessage(sign(notification(), '2', other), { fetchCert })).toBe(false)
    expect(await verifySnsMessage({ ...sign(notification()), SignatureVersion: '3' }, { fetchCert })).toBe(false)
    expect(await verifySnsMessage({ ...notification(), SignatureVersion: '2' }, { fetchCert })).toBe(false)
  })

  it('pins the topic when given one, or a list of them', async () => {
    const { fetchCert } = certFetcher()
    const other = sign(notification({ TopicArn: 'arn:aws:sns:us-east-1:999999999999:someone-else' }))
    expect(await verifySnsMessage(other, { fetchCert })).toBe(true)
    expect(await verifySnsMessage(other, { fetchCert, topicArn: TOPIC })).toBe(false)
    expect(await verifySnsMessage(sign(notification()), { fetchCert, topicArn: TOPIC })).toBe(true)
    expect(await verifySnsMessage(sign(notification()), { fetchCert, topicArn: ['arn:x', TOPIC] })).toBe(true)
  })

  it('never throws: bad input and a failed certificate fetch are false', async () => {
    expect(await verifySnsMessage(null)).toBe(false)
    expect(await verifySnsMessage('{"Type":"Notification"}')).toBe(false)
    const fetchCert = vi.fn(async () => Promise.reject(new Error('ENOTFOUND')))
    expect(await verifySnsMessage(sign(notification()), { fetchCert })).toBe(false)
  })
})

describe('fetchSigningCert', () => {
  it('reads the public key from a valid certificate, refusing redirects, and caches it', async () => {
    const url = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-cache.pem'
    const fetch = fakeFetch(validPem)
    const key = await fetchSigningCert(url, { fetch })
    expect(key.asymmetricKeyType).toBe('rsa')
    expect(fetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) })
    )
    await fetchSigningCert(url, { fetch })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('verifies a real signature end to end through the certificate', async () => {
    const url = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-e2e.pem'
    const fetch = fakeFetch(validPem)
    const fetchCert = (u) => fetchSigningCert(u, { fetch })
    expect(await verifySnsMessage(sign(notification({ SigningCertURL: url })), { fetchCert })).toBe(true)
  })

  it('refuses an expired certificate and one not yet valid', async () => {
    const expired = makeCertificate({
      notBefore: new Date(Date.now() - 400 * DAY),
      notAfter: new Date(Date.now() - DAY)
    })
    const future = makeCertificate({
      notBefore: new Date(Date.now() + DAY),
      notAfter: new Date(Date.now() + 400 * DAY)
    })
    await expect(
      fetchSigningCert('https://sns.us-east-1.amazonaws.com/expired.pem', { fetch: fakeFetch(expired) })
    ).rejects.toThrow(/not currently valid/)
    await expect(
      fetchSigningCert('https://sns.us-east-1.amazonaws.com/future.pem', { fetch: fakeFetch(future) })
    ).rejects.toThrow(/not currently valid/)
  })

  it('refuses an HTTP error and a body that is not a certificate', async () => {
    await expect(
      fetchSigningCert('https://sns.us-east-1.amazonaws.com/404.pem', { fetch: fakeFetch('', { status: 404 }) })
    ).rejects.toThrow(/HTTP 404/)
    await expect(
      fetchSigningCert('https://sns.us-east-1.amazonaws.com/junk.pem', { fetch: fakeFetch('<html>') })
    ).rejects.toThrow()
  })
})

describe('confirmSubscription', () => {
  it('GETs the SubscribeURL with no redirects and a timeout', async () => {
    const fetch = fakeFetch('<ConfirmSubscriptionResponse/>')
    expect(await confirmSubscription(confirmation(), { fetch })).toEqual({ ok: true, status: 200 })
    expect(fetch).toHaveBeenCalledWith(
      SUBSCRIBE_URL,
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) })
    )
  })

  it('never opens a SubscribeURL off the SNS endpoint of the topic region', async () => {
    const fetch = fakeFetch('')
    for (const SubscribeURL of [
      'https://sns.s3.amazonaws.com/?Action=ConfirmSubscription&Token=tok',
      'https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&Token=tok',
      'http://169.254.169.254/latest/meta-data/'
    ]) {
      await expect(confirmSubscription(confirmation({ SubscribeURL }), { fetch }), SubscribeURL).rejects.toThrow(
        /not the SNS endpoint/
      )
    }
    await expect(confirmSubscription(notification(), { fetch })).rejects.toThrow(/not a SubscriptionConfirmation/)
    expect(fetch).not.toHaveBeenCalled()
  })
})
