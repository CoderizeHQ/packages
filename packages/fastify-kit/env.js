/**
 * Fails fast at startup: throws one error naming every required variable that is unset or blank, so a
 * deploy missing three settings says so once instead of three restarts in a row. A value of only
 * whitespace counts as missing (an empty line in SSM is not a secret). Values never appear in the error.
 *
 * Loads nothing: the API's scripts load `.env` with `--env-file`, and tests must never read it.
 *
 * ```js
 * // src/lib/env.js, imported first by app.js
 * import { requireEnv } from '@coderize/fastify-kit'
 *
 * requireEnv(['DATABASE_URL', 'JWT_SECRET', 'CORS_ORIGINS'])
 * export const env = process.env
 * ```
 * @param {string[]} names
 * @param {Record<string, string | undefined>} [env] `process.env` by default
 * @returns {Record<string, string>} the required values, by name
 */
export function requireEnv(names, env = process.env) {
  if (!Array.isArray(names) || names.some((name) => typeof name !== 'string' || name === '')) {
    throw new TypeError('requireEnv: names must be an array of variable names')
  }
  const missing = names.filter((name) => typeof env[name] !== 'string' || env[name].trim() === '')
  if (missing.length > 0) {
    const error = new Error(`Missing required environment variables: ${missing.join(', ')}`)
    error.name = 'MissingEnvError'
    error.code = 'MISSING_ENV'
    error.missing = missing
    throw error
  }
  return Object.fromEntries(names.map((name) => [name, env[name]]))
}
