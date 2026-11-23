// Types for `@coderize/email/sns`. Hand-written to match sns.js; test/types/consumer.ts type-checks them.
import type { KeyObject } from 'node:crypto'

/** An SNS message as posted to an HTTPS subscription (JSON, sent as text/plain). */
export interface SnsMessage {
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation' | (string & {})
  MessageId: string
  TopicArn: string
  Message: string
  Timestamp: string
  SignatureVersion: string
  Signature: string
  SigningCertURL: string
  Subject?: string
  SubscribeURL?: string
  Token?: string
  UnsubscribeURL?: string
}

/** The AWS region in an SNS topic ARN, or null. */
export declare function topicRegion(topicArn: unknown): string | null

/** Whether a URL is HTTPS on exactly `sns.<region>.amazonaws.com` (and ends in .pem when `pem`). */
export declare function isSnsUrl(url: unknown, options?: { region?: string | null; pem?: boolean }): boolean

/** The exact string SNS signed for this message, or null. */
export declare function signingString(message: Record<string, unknown> | null | undefined): string | null

/** Fetches (or reads from the cache) the signing certificate's public key. Throws unless it is valid now. */
export declare function fetchSigningCert(url: string, options?: { fetch?: typeof fetch }): Promise<KeyObject>

export interface VerifySnsOptions {
  /** The topic, or topics, this route accepts. */
  topicArn?: string | string[]
  /** Replaces the certificate download (tests). */
  fetchCert?: (url: string) => Promise<KeyObject | string>
}

/** Whether a message is genuinely from SNS (and from `topicArn`). Never throws. */
export declare function verifySnsMessage(message: unknown, options?: VerifySnsOptions): Promise<boolean>

/** GETs the SubscribeURL of a verified SubscriptionConfirmation. Throws when the URL is not SNS's. */
export declare function confirmSubscription(
  message: SnsMessage | Record<string, unknown>,
  options?: { fetch?: typeof fetch }
): Promise<{ ok: boolean; status: number }>
