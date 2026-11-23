// How an answer from form-api-ses (or from S3, for an upload) becomes a result the form can show.
//
// form-api-ses answers every refusal with JSON `{ error }` written for the visitor ("Too many submissions. Please
// try again later or call us."), so that text is what the form shows. API Gateway's own errors, in front of the
// function, use `{ message }` instead.

export const NETWORK_MESSAGE = "We couldn't reach the server. Check your connection and try again."
export const FALLBACK_MESSAGE = 'Something went wrong sending the form. Please try again.'

/** The body as JSON, or `{}` when it is empty or isn't JSON. */
export async function readJson(response) {
  try {
    const body = await response.json()
    return body && typeof body === 'object' ? body : {}
  } catch {
    return {}
  }
}

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null)

/** A refusal the API answered, with its own message when it sent one. */
export function failure(status, body) {
  return { ok: false, status, message: text(body?.error) ?? text(body?.message) ?? FALLBACK_MESSAGE }
}

/**
 * A request that got no answer at all: offline, DNS, or a CORS refusal. A browser hides the reason for a CORS
 * refusal from the page, so an origin that isn't on form-api-ses's allow-list at all looks exactly like this.
 */
export function networkFailure() {
  return { ok: false, status: 0, message: NETWORK_MESSAGE }
}

/** A request the caller cancelled is the caller's own doing, so it is rethrown, not reported as a failure. */
export const cancelled = (signal) => Boolean(signal?.aborted)
