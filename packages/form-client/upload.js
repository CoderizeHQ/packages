// File uploads, for a client with `uploads` set in form-api-ses clients.json. The file never passes through the
// API: it hands out a presigned POST for one file, the browser sends the file straight to the uploads bucket, and
// the form is then submitted with the key in `uploads`. The owner's email links to the file for 30 days.

import { requireClient, requireEndpoint } from './errors.js'
import { cancelled, failure, networkFailure, readJson } from './result.js'

export const STORAGE_REFUSED_MESSAGE = 'The file was not accepted for upload. Please try again.'

/**
 * Sends the multipart POST to S3 and resolves its status. XMLHttpRequest only when progress is wanted, because
 * fetch can't report upload progress.
 */
function postToStorage(url, body, { signal, onProgress }) {
  const Xhr = globalThis.XMLHttpRequest
  if (!onProgress || !Xhr) return fetch(url, { method: 'POST', body, signal }).then((res) => res.status)

  return new Promise((resolve, reject) => {
    const xhr = new Xhr()
    const abort = () => xhr.abort()
    xhr.open('POST', url)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    xhr.onload = () => resolve(xhr.status)
    xhr.onerror = () => reject(new TypeError('Upload failed'))
    xhr.onabort = () => reject(signal?.reason ?? new DOMException('Upload cancelled', 'AbortError'))
    xhr.onloadend = () => signal?.removeEventListener('abort', abort)
    signal?.addEventListener('abort', abort, { once: true })
    xhr.send(body)
  })
}

/**
 * Uploads one file and resolves its key, to send in the form's `uploads` (`submitForm` does both when given
 * `files`). Like `submitForm`, it never throws for a refusal: a type the client doesn't accept (415), a file over
 * its limit (413) or too many uploads (429) resolve `ok: false` with the API's own message.
 *
 * @param {{ endpoint: string | null | undefined, client: string, file: Blob, signal?: AbortSignal,
 *   onProgress?: (fraction: number) => void }} options
 * @returns {Promise<{ ok: true, key: string } | { ok: false, status: number, message: string }>}
 */
export async function uploadFile({ endpoint, client, file, signal, onProgress }) {
  const base = requireEndpoint(endpoint, 'uploadFile')
  const clientKey = requireClient(client, 'uploadFile')

  let target
  try {
    const res = await fetch(new URL('/upload', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client: clientKey, filename: file?.name ?? '', size: file?.size ?? 0 }),
      signal,
    })
    target = await readJson(res)
    if (!res.ok) return failure(res.status, target)
  } catch (err) {
    if (cancelled(signal)) throw err
    return networkFailure()
  }

  // The policy covers every field S3 is sent, and S3 ignores anything after the file, so the file goes last.
  const body = new FormData()
  for (const [name, value] of Object.entries(target.fields ?? {})) body.append(name, value)
  body.append('file', file)

  try {
    const status = await postToStorage(target.url, body, { signal, onProgress })
    if (status < 200 || status >= 300) return { ok: false, status, message: STORAGE_REFUSED_MESSAGE }
  } catch (err) {
    if (cancelled(signal)) throw err
    return networkFailure()
  }
  return { ok: true, key: target.key }
}
