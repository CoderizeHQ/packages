import fp from 'fastify-plugin'

/**
 * @typedef {object} RawJsonBodyOptions
 * @property {string[]} [contentTypes] the content types to keep raw, `['application/json']` by default.
 *   SNS posts its JSON as `text/plain`, so an SES events route passes `['application/json', 'text/plain']`.
 * @property {number} [bodyLimit] bytes, Fastify's own limit by default
 */

async function rawJsonBodyPlugin(app, { contentTypes = ['application/json'], bodyLimit } = {}) {
  if (!Array.isArray(contentTypes) || contentTypes.length === 0) {
    throw new TypeError('rawJsonBody: contentTypes must be a non-empty array')
  }
  // The same parser Fastify uses everywhere else, with the instance's own poisoning settings
  // ('error' unless the API changed them).
  const { onProtoPoisoning = 'error', onConstructorPoisoning = 'error' } = app.initialConfig
  const parseJson = app.getDefaultJsonParser(onProtoPoisoning, onConstructorPoisoning)

  if (!app.hasRequestDecorator('rawBody')) app.decorateRequest('rawBody', null)

  // Marks the routes beside it as webhooks, so the error handler answers a database error there with a
  // reported 500 rather than a 404 or 409 the sender would take as final. A route that sets
  // `config.webhook` itself keeps its own value.
  app.addHook('onRoute', (routeOptions) => {
    if (routeOptions.config?.webhook === undefined) routeOptions.config = { ...routeOptions.config, webhook: true }
  })

  for (const contentType of contentTypes) {
    // Only this plugin's context loses the inherited parser; the parent's stays as it was.
    if (app.hasContentTypeParser(contentType)) app.removeContentTypeParser(contentType)
    app.addContentTypeParser(
      contentType,
      { parseAs: 'buffer', ...(bodyLimit !== undefined && { bodyLimit }) },
      (request, body, done) => {
        request.rawBody = body
        parseJson(request, body, done)
      },
    )
  }
}

/**
 * Keeps the request's exact bytes in `request.rawBody` (a Buffer) for the routes registered beside it, so
 * a webhook can check its signature, and still parses `request.body` as JSON through Fastify's own safe
 * parser: prototype-poisoning protection stays on, and malformed or empty JSON answers 400.
 *
 * Register it inside the webhook routes' own plugin, never at the root, so every other route keeps
 * Fastify's parser untouched, and before those routes: it marks each route added after it with
 * `config.webhook`, which createErrorHandler reads to keep a database error there a reported 500:
 *
 * ```js
 * await app.register(async (webhooks) => {
 *   await webhooks.register(rawJsonBody)
 *   webhooks.post('/stripe', async (request) => verifyWebhook({ rawBody: request.rawBody, ... }))
 * }, { prefix: '/webhooks' })
 * ```
 *
 * Replaces the global `JSON.parse` parsers in bluecopperit, icrotary and xceptionalheroes (which dropped
 * the prototype-poisoning guard for every route) and the `fastify-raw-body` dependency.
 * @param {import('fastify').FastifyInstance} app
 * @param {RawJsonBodyOptions} [options]
 */
export const rawJsonBody = fp(rawJsonBodyPlugin, { fastify: '5.x', name: '@coderizehq/fastify-kit/raw-json-body' })
