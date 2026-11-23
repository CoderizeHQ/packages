// Types for TypeScript consumers. Hand-written to match index.js; test/types/consumer.ts type-checks them
// on every `pnpm test`.

/** One address (`a@b.com` or `Name <a@b.com>`) or a flat list of them. Never a nested list. */
export type Recipients = string | ReadonlyArray<string | null | undefined> | null | undefined

export interface Attachment {
  /** Shown to the recipient. Path parts and control characters are dropped. */
  filename: string
  /** The bytes, or a base64 string (Resend's shape). Any other string is refused. */
  content: Uint8Array | string
  /** Inferred from the filename's extension when left out; `application/octet-stream` otherwise. */
  contentType?: string
}

export interface EmailMessage {
  /** Overrides the mailer's default From. */
  from?: string
  /** Empty (or only empty entries) means the send is skipped. */
  to: Recipients
  cc?: Recipients
  /** Envelope only: never written into the message. */
  bcc?: Recipients
  replyTo?: Recipients
  subject: string
  /** At least one of `text` and `html` is required. Send both where you can. */
  text?: string
  html?: string
  /** Extra headers, e.g. `List-Unsubscribe` and `List-Unsubscribe-Post`. Not From, To, Subject and the like. */
  headers?: Record<string, string | number>
  /** Any attachment sends the message as raw MIME. */
  attachments?: ReadonlyArray<Attachment>
  /** Overrides the mailer's configuration set for this message. Its ARN must be in the sender's IAM policy. */
  configurationSet?: string
}

export type SendResult =
  { status: 'sent'; id: string | null } | { status: 'logged'; id: null } | { status: 'skipped'; id: null }

export type TrySendResult =
  ({ ok: true; error: null } & SendResult) | { ok: false; status: 'failed'; id: null; error: SendError }

export interface Logger {
  info(obj: object, msg?: string): unknown
  error(obj: object, msg?: string): unknown
}

/** The part of SESv2Client the mailer uses. */
export interface SesClientLike {
  send(command: any): Promise<{ MessageId?: string }>
}

export interface MailerOptions {
  /** The app's default From. */
  from?: string
  /** A configuration set to name on every send. None by default: the identity's default set applies. */
  configurationSet?: string
  /** An SESv2Client. Inject a fake in tests; by default one is built on the first real send. */
  client?: SesClientLike
  /** Defaults to `AWS_REGION`, then us-east-1. */
  region?: string
  /** pino (`app.log`) or console, the default. */
  logger?: Logger
  /** Defaults to `process.env`. Read once, when the mailer is created. */
  env?: Record<string, string | undefined>
}

export interface Mailer {
  /** `ses` when EMAIL_PROVIDER is `ses`; `log` otherwise. */
  readonly mode: 'ses' | 'log'
  /** Sends, logs or skips. Throws a SendError (already logged) when the message did not go out. */
  send(message: EmailMessage): Promise<SendResult>
  /** `send()` that never throws. */
  trySend(message: EmailMessage): Promise<TrySendResult>
}

/** A mailer for one app: SES when EMAIL_PROVIDER is `ses`, a log line otherwise. */
export declare function createMailer(options?: MailerOptions): Mailer

/** What `send()` throws when a message did not go out. */
export declare class SendError extends Error {
  constructor(message: string, kind: 'transient' | 'permanent', options?: { cause?: unknown })
  name: 'SendError'
  /** `transient`: worth retrying later. `permanent`: retrying the same message won't help. */
  kind: 'transient' | 'permanent'
}

/** Whether an AWS SDK v3 error is worth retrying (throttle, 5xx, retryable, or no answer at all). */
export declare function isTransientAwsError(error: unknown): boolean

/** The raw MIME message `send()` builds for a message with attachments. */
export declare function buildRawMessage(message: EmailMessage, defaults?: { from?: string }): Buffer

/** Escapes a value for HTML text or a quoted attribute; null and undefined become ''. */
export declare function esc(value: unknown): string
