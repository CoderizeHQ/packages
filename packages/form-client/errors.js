/**
 * Thrown for a setup mistake in the site, never for anything a visitor did: a missing or invalid endpoint, or a
 * missing client key. A form that resolved "sent" here would lose every lead without anyone noticing, so this
 * fails loudly instead.
 */
export class FormClientConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'FormClientConfigError'
  }
}

/**
 * The endpoint as a URL, or a FormClientConfigError. An unset `PUBLIC_FORM_API_URL` reaches here as `undefined`
 * (Vite) or `''` (an empty repo variable in the build).
 * @param {unknown} endpoint
 * @param {string} caller
 * @returns {URL}
 */
export function requireEndpoint(endpoint, caller) {
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    throw new FormClientConfigError(
      `${caller}: endpoint is missing. Pass import.meta.env.PUBLIC_FORM_API_URL and check that the site's build sets it.`
    )
  }
  try {
    return new URL(endpoint.trim())
  } catch {
    throw new FormClientConfigError(`${caller}: endpoint "${endpoint}" is not an absolute URL.`)
  }
}

/**
 * @param {unknown} client
 * @param {string} caller
 * @returns {string}
 */
export function requireClient(client, caller) {
  if (typeof client !== 'string' || !client.trim()) {
    throw new FormClientConfigError(`${caller}: client is missing. Pass the site's key in form-api-ses clients.json.`)
  }
  return client.trim()
}
