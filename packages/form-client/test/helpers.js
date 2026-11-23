import { vi } from 'vitest'

export const ENDPOINT = 'https://forms.example.test/'

/** A JSON response as form-api-ses sends one. */
export const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * Replaces the global fetch with a mock that answers each call with the next item: a Response, or an Error to
 * reject with. Restore with vi.unstubAllGlobals().
 */
export function mockFetch(...answers) {
  const fetch = vi.fn(async () => {
    const next = answers.shift()
    if (!next) throw new Error('unexpected fetch')
    if (next instanceof Error) throw next
    return next
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

/** The parsed JSON body of the fetch call at `index`. */
export const sentBody = (fetch, index = 0) => JSON.parse(fetch.mock.calls[index][1].body)

/** A guard with fixed answers, so a test controls the traps exactly. */
export const fixedGuard = (website = '', fillMs = 8421) => ({ fields: () => ({ website, _fillMs: fillMs }) })
