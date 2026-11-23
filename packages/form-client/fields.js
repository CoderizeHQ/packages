// Turns a form's fields into the JSON body form-api-ses expects, keeping the visitor's fields away from the keys
// the API reads as settings.

import { HONEYPOT_FIELD } from './guard.js'

/**
 * Keys form-api-ses reads as settings, not as form fields (META_FIELDS in its index.js). None of them reaches the
 * notification email as a row, and some change what the API does: `client` picks the recipient, `subject`
 * replaces the email's subject, `redirect` turns the answer into a 302, `uploads` must hold keys the API issued,
 * `website` and `_fillMs` are the spam traps.
 */
export const RESERVED_FIELDS = Object.freeze([
  'client',
  'form',
  'subject',
  'redirect',
  HONEYPOT_FIELD,
  'consent',
  '_fillMs',
  'uploads'
])

const RESERVED = new Set(RESERVED_FIELDS)

/** A field that collides with a reserved key is sent under this name instead, so its value still reaches the email. */
export const renamedField = (key) => `${key}_field`

const isBlob = (value) => typeof Blob !== 'undefined' && value instanceof Blob
const isFormData = (value) => typeof FormData !== 'undefined' && value instanceof FormData

/**
 * The fields as one object (repeated FormData names, such as a checkbox group, become an array) plus the files
 * among them. An empty file input, which FormData reports as a nameless 0-byte file, is left out.
 */
function readFields(fields) {
  const entries = fields == null ? [] : isFormData(fields) ? [...fields.entries()] : Object.entries(fields)
  const values = {}
  const files = []
  for (const [key, value] of entries) {
    if (isBlob(value)) {
      if (value.size > 0) files.push(value)
    } else if (Object.hasOwn(values, key)) {
      values[key] = [].concat(values[key], value)
    } else {
      values[key] = value
    }
  }
  return { values, files }
}

/**
 * The request body and the files to upload first.
 *
 * Without a guard, a `website` field is the honeypot, which is how the sites have always wired it. With one, the
 * guard is the only source of the traps: a `website` field equal to the guard's honeypot is that same input read
 * twice and is dropped, and any other `website` is a real field. Every other reserved name is renamed with
 * `renamedField`, so a field can never change the client, the form, the subject or the traps.
 *
 * @returns {{ body: Record<string, unknown>, files: Blob[], renamed: string[] }}
 */
export function buildBody({ client, form, subject, fields, guard }) {
  const { values, files } = readFields(fields)
  const traps = guard ? guard.fields() : null
  let honeypot = ''
  const renamed = []
  const sent = {}

  for (const [key, value] of Object.entries(values)) {
    if (key === HONEYPOT_FIELD) {
      if (!traps) {
        honeypot = value
        continue
      }
      if (String(value ?? '') === String(traps.website ?? '')) continue
    }
    if (RESERVED.has(key)) {
      sent[renamedField(key)] = value
      renamed.push(key)
    } else {
      sent[key] = value
    }
  }

  if (traps) honeypot = traps.website
  const fillMs = traps?._fillMs

  const body = {
    client,
    ...(form ? { form } : {}),
    ...(subject ? { subject } : {}),
    ...sent,
    [HONEYPOT_FIELD]: honeypot == null ? '' : String(honeypot),
    ...(Number.isFinite(fillMs) ? { _fillMs: fillMs } : {})
  }
  return { body, files, renamed }
}
