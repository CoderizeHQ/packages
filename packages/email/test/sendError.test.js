import { describe, expect, it } from 'vitest'

import { esc, isTransientAwsError, SendError } from '../index.js'
import { awsError } from './helpers.js'

describe('isTransientAwsError', () => {
  it.each([
    ['ThrottlingException', 400],
    ['TooManyRequestsException', 429],
    ['LimitExceededException', 400],
    ['InternalFailure', 500],
    ['ServiceUnavailable', 503],
    ['SomethingNew', 502]
  ])('treats %s (HTTP %i) as transient', (name, status) => {
    expect(isTransientAwsError(awsError(name, { status }))).toBe(true)
  })

  it('treats anything the SDK marked retryable as transient', () => {
    expect(isTransientAwsError(awsError('Odd', { $retryable: { throttling: true } }))).toBe(true)
  })

  it('treats an error with no answer from AWS (DNS, reset, timeout) as transient', () => {
    const reset = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
    expect(isTransientAwsError(reset)).toBe(true)
  })

  it.each([
    'AccessDeniedException',
    'MessageRejected',
    'MailFromDomainNotVerifiedException',
    'NotFoundException',
    'BadRequestException'
  ])('treats %s as permanent', (name) => {
    expect(isTransientAwsError(awsError(name, { status: name === 'AccessDeniedException' ? 403 : 400 }))).toBe(false)
  })
})

describe('SendError', () => {
  it('carries its kind and cause', () => {
    const cause = new Error('x')
    const error = new SendError('Email not sent', 'transient', { cause })
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ name: 'SendError', kind: 'transient', cause, message: 'Email not sent' })
  })
})

describe('esc', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(esc(`<a href="x" title='y'>Tom & Jerry</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;'
    )
  })

  it('turns null and undefined into an empty string, and anything else into its string', () => {
    expect(esc(null)).toBe('')
    expect(esc(undefined)).toBe('')
    expect(esc(0)).toBe('0')
    expect(esc(false)).toBe('false')
  })

  it('escapes text that is already escaped again, so escape once, where the template interpolates', () => {
    expect(esc('&amp;')).toBe('&amp;amp;')
  })
})
