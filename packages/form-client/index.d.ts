/** A refusal from form-api-ses (or S3, for an upload), or `status: 0` when nothing answered. */
export interface FormFailure {
  ok: false
  status: number
  /** The API's own message for the visitor, or a generic one when it sent none. */
  message: string
}

export type SubmitFormResult = { ok: true } | FormFailure

export type UploadFileResult = { ok: true; key: string } | FormFailure

/** What the spam traps report at submit time. */
export interface GuardFields {
  website: string
  _fillMs?: number
}

export interface FormGuard {
  /** Restarts the fill-time clock, for a form shown after the page loaded. */
  start(): void
  /** Records the honeypot's value, for a controlled input. */
  setTrap(value: string): void
  fields(): GuardFields
}

/** Any form, as far as the guard is concerned: an `HTMLFormElement` fits. */
export interface FormWithControls {
  elements: { namedItem(name: string): unknown }
}

export interface SubmitFormOptions {
  /** The site's `PUBLIC_FORM_API_URL`. Missing or empty throws `FormClientConfigError`. */
  endpoint: string | null | undefined
  /** The site's key in form-api-ses clients.json. */
  client: string
  /** Picks the form's own subject and recipient in clients.json. */
  form?: string
  /** Replaces the notification email's subject. */
  subject?: string
  /** What the visitor filled in. Reserved names are renamed (`subject` becomes `subject_field`). */
  fields?: Record<string, unknown> | FormData
  guard?: Pick<FormGuard, 'fields'> | null
  /** Files to upload before submitting. Files in a FormData `fields` are added to these. */
  files?: ArrayLike<Blob> | Iterable<Blob>
  /** Keys of files already sent with `uploadFile`. */
  uploads?: string[]
  signal?: AbortSignal
}

export interface UploadFileOptions {
  endpoint: string | null | undefined
  client: string
  file: Blob
  signal?: AbortSignal
  /** From 0 to 1. Uses XMLHttpRequest, since fetch can't report upload progress. */
  onProgress?: (fraction: number) => void
}

/** A setup mistake in the site: a missing or invalid endpoint, or a missing client key. */
export declare class FormClientConfigError extends Error {
  name: 'FormClientConfigError'
}

/** Keys form-api-ses reads as settings rather than form fields. */
export declare const RESERVED_FIELDS: readonly string[]

/** The honeypot's field name, fixed by form-api-ses. */
export declare const HONEYPOT_FIELD: 'website'

/** Starts the fill-time clock now. With `form`, the honeypot is read from its `website` control. */
export declare function createFormGuard(options?: { form?: FormWithControls | null }): FormGuard

/** Sends one form. Throws only for a setup mistake or the caller's own abort. */
export declare function submitForm(options: SubmitFormOptions): Promise<SubmitFormResult>

/** Uploads one file and resolves its key, for `uploads`. Throws only for a setup mistake or an abort. */
export declare function uploadFile(options: UploadFileOptions): Promise<UploadFileResult>
