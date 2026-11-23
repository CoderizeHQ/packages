import { requireClient, requireEndpoint } from './errors.js'
import { buildBody, renamedField } from './fields.js'
import { cancelled, failure, networkFailure, readJson } from './result.js'
import { uploadFile } from './upload.js'

/**
 * Sends one form to form-api-ses.
 *
 * Resolves `{ ok: true }` when the API accepted it, including the silent success it gives a spam trap. Resolves
 * `{ ok: false, status, message }` for everything else, with the API's own message for the visitor: 400 bad or
 * empty form, 403 an origin not listed for the client, 413 and 415 from an upload, 429 too many submissions, 5xx,
 * and `status: 0` when nothing answered. It throws only for a setup mistake (`FormClientConfigError`) and when the
 * caller aborts through `signal`.
 *
 * @param {object} options
 * @param {string | null | undefined} options.endpoint the site's `PUBLIC_FORM_API_URL`
 * @param {string} options.client the site's key in form-api-ses clients.json
 * @param {string} [options.form] picks the form's own subject and recipient in clients.json
 * @param {string} [options.subject] replaces the notification email's subject
 * @param {Record<string, unknown> | FormData} [options.fields] what the visitor filled in
 * @param {{ fields(): { website: string, _fillMs?: number } } | null} [options.guard] from `createFormGuard` or `useFormGuard`
 * @param {ArrayLike<Blob> | Iterable<Blob>} [options.files] files to upload first; FormData files are added to these
 * @param {string[]} [options.uploads] keys of files already sent with `uploadFile`
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ ok: true } | { ok: false, status: number, message: string }>}
 */
export async function submitForm({ endpoint, client, form, subject, fields, guard, files, uploads, signal }) {
  const url = requireEndpoint(endpoint, 'submitForm')
  const clientKey = requireClient(client, 'submitForm')
  const built = buildBody({ client: clientKey, form, subject, fields, guard })

  for (const key of built.renamed) {
    console.warn(`[form-client] "${key}" is reserved by form-api-ses, so the field was sent as "${renamedField(key)}".`)
  }

  const keys = [...(uploads ?? [])]
  for (const file of [...Array.from(files ?? []), ...built.files]) {
    const uploaded = await uploadFile({ endpoint, client: clientKey, file, signal })
    if (!uploaded.ok) return uploaded
    keys.push(uploaded.key)
  }
  const body = keys.length ? { ...built.body, uploads: keys } : built.body

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (cancelled(signal)) throw err
    return networkFailure()
  }
  if (res.ok) return { ok: true }
  return failure(res.status, await readJson(res))
}
