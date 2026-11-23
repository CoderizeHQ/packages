import { afterEach, describe, expect, it, vi } from 'vitest'

import { submitForm, uploadFile } from '../index.js'
import { ENDPOINT, fixedGuard, json, mockFetch, sentBody } from './helpers.js'

// The presigned POST form-api-ses returns from POST /upload (presignUpload in its index.js), trimmed.
const KEY = 'clientkey/0b6f8a9e-5c1d-4f2a-9b3e-7d4c2a1f0e9d/artwork.pdf'
const presigned = () =>
  json(200, {
    url: 'https://uploads.example.test/',
    fields: { bucket: 'uploads', key: KEY, 'Content-Type': 'application/pdf', Policy: 'e30=', 'X-Amz-Signature': 'ab' },
    key: KEY,
    maxBytes: 26214400
  })
// S3 answers a successful POST with 204 and no body.
const stored = () => new Response(null, { status: 204 })

const pdf = () => new File(['%PDF-1.7'], 'artwork.pdf', { type: 'application/pdf' })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('uploadFile', () => {
  it('asks the API for a presigned POST, then sends the fields and the file, last, to storage', async () => {
    const fetch = mockFetch(presigned(), stored())
    const file = pdf()

    await expect(uploadFile({ endpoint: ENDPOINT, client: 'clientkey', file })).resolves.toEqual({ ok: true, key: KEY })

    const [presignUrl, presignInit] = fetch.mock.calls[0]
    expect(String(presignUrl)).toBe('https://forms.example.test/upload')
    expect(JSON.parse(presignInit.body)).toEqual({ client: 'clientkey', filename: 'artwork.pdf', size: file.size })

    const [storageUrl, storageInit] = fetch.mock.calls[1]
    expect(storageUrl).toBe('https://uploads.example.test/')
    const names = [...storageInit.body.keys()]
    expect(names).toEqual(['bucket', 'key', 'Content-Type', 'Policy', 'X-Amz-Signature', 'file'])
    expect(storageInit.body.get('file').name).toBe('artwork.pdf')
  })

  it('posts to /upload on the API host whatever the endpoint path', async () => {
    const fetch = mockFetch(presigned(), stored())
    await uploadFile({ endpoint: 'https://forms.example.test', client: 'clientkey', file: pdf() })
    expect(String(fetch.mock.calls[0][0])).toBe('https://forms.example.test/upload')
  })

  it("surfaces the API's refusal of a type or a size", async () => {
    mockFetch(json(415, { error: "That type of file can't be uploaded here. Allowed: PNG, PDF." }))
    await expect(uploadFile({ endpoint: ENDPOINT, client: 'clientkey', file: pdf() })).resolves.toEqual({
      ok: false,
      status: 415,
      message: "That type of file can't be uploaded here. Allowed: PNG, PDF."
    })
  })

  it('reports storage refusing the file', async () => {
    mockFetch(presigned(), new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }))
    const result = await uploadFile({ endpoint: ENDPOINT, client: 'clientkey', file: pdf() })
    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(result.message).toMatch(/not accepted/)
  })

  it('resolves status 0 when storage does not answer (a bucket CORS rule missing the origin)', async () => {
    mockFetch(presigned(), new TypeError('Failed to fetch'))
    await expect(uploadFile({ endpoint: ENDPOINT, client: 'clientkey', file: pdf() })).resolves.toMatchObject({
      ok: false,
      status: 0
    })
  })

  it('throws for a missing endpoint', async () => {
    mockFetch()
    await expect(uploadFile({ endpoint: undefined, client: 'clientkey', file: pdf() })).rejects.toThrow(
      /endpoint is missing/
    )
  })

  it('reports progress through XMLHttpRequest when asked', async () => {
    mockFetch(presigned())
    const sent = []
    class FakeXhr {
      upload = {}
      open(method, url) {
        sent.push({ method, url })
      }
      send(body) {
        sent.at(-1).body = body
        this.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 })
        this.status = 204
        this.onload()
        this.onloadend()
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    const onProgress = vi.fn()

    await expect(uploadFile({ endpoint: ENDPOINT, client: 'clientkey', file: pdf(), onProgress })).resolves.toEqual({
      ok: true,
      key: KEY
    })
    expect(sent[0]).toMatchObject({ method: 'POST', url: 'https://uploads.example.test/' })
    expect(sent[0].body.get('file').name).toBe('artwork.pdf')
    expect(onProgress).toHaveBeenCalledWith(0.5)
  })
})

describe('submitForm with files', () => {
  it('uploads each file first and submits the keys in uploads', async () => {
    const fetch = mockFetch(presigned(), stored(), json(200, { ok: true, message: 'Message sent!' }))

    await expect(
      submitForm({
        endpoint: ENDPOINT,
        client: 'clientkey',
        fields: { name: 'Jane' },
        files: [pdf()],
        uploads: ['clientkey/11111111-1111-4111-8111-111111111111/logo.png'],
        guard: fixedGuard()
      })
    ).resolves.toEqual({ ok: true })

    expect(sentBody(fetch, 2).uploads).toEqual(['clientkey/11111111-1111-4111-8111-111111111111/logo.png', KEY])
  })

  it('takes the files out of a FormData, so none is sent as a field', async () => {
    const fetch = mockFetch(presigned(), stored(), json(200, { ok: true }))
    const data = new FormData()
    data.append('name', 'Jane')
    data.append('artwork', pdf())

    await submitForm({ endpoint: ENDPOINT, client: 'clientkey', fields: data, guard: fixedGuard() })

    const body = sentBody(fetch, 2)
    expect(body.uploads).toEqual([KEY])
    expect(body).not.toHaveProperty('artwork')
  })

  it('does not submit the form when an upload is refused', async () => {
    const fetch = mockFetch(json(413, { error: 'That file is over 25.0 MB. Please send a smaller one.' }))

    await expect(
      submitForm({ endpoint: ENDPOINT, client: 'clientkey', fields: { name: 'Jane' }, files: [pdf()] })
    ).resolves.toEqual({ ok: false, status: 413, message: 'That file is over 25.0 MB. Please send a smaller one.' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
