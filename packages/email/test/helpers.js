import { readFileSync } from 'node:fs'

import { vi } from 'vitest'

/**
 * A stand-in for SESv2Client. Every test that reaches the SES path injects one of these, so no test can
 * send real mail or even build a real client.
 * @param {(command: any) => Promise<object>} [respond]
 */
export function fakeSes(respond = async () => ({ MessageId: 'ses-message-1' })) {
  const send = vi.fn(respond)
  return { send, input: () => send.mock.calls.at(-1)?.[0].input }
}

/** A logger that records instead of printing. */
export function fakeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}

/** The env of a deployed app that sends. */
export const SES_ENV = Object.freeze({ EMAIL_PROVIDER: 'ses', NODE_ENV: 'production' })

/** An AWS SDK v3 service error, as the SDK shapes one. */
export function awsError(name, { status = 400, message = `${name} happened`, ...extra } = {}) {
  const error = new Error(message)
  error.name = name
  error.$fault = status >= 500 ? 'server' : 'client'
  error.$metadata = { httpStatusCode: status, requestId: 'req-123', attempts: 1 }
  return Object.assign(error, extra)
}

/** @param {string} name a file in test/fixtures */
export const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url))
