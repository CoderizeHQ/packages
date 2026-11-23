import proxyAddr from '@fastify/proxy-addr'

const isPrivate = proxyAddr.compile(['loopback', 'linklocal', 'uniquelocal'])

/**
 * Fastify `trustProxy`: trust exactly one hop, Caddy, and only when that hop is on the private Docker network
 * (or loopback) it shares with this container. request.ip is then the client address Caddy forwarded, which
 * the per-IP rate limits key on.
 *
 * Why not `trustProxy: 1`: Fastify 5.12 disabled numeric hop counts (they fail closed, because a count can't
 * tell the proxy from a client that reached the port directly), so `1` makes request.ip Caddy's address and
 * puts every visitor in one rate-limit bucket. Leaving it unset does the same. And not `true`: that trusts
 * every X-Forwarded-For entry, so a client could forge its own IP and walk past the limits.
 *
 * The app's Caddyfile must leave X-Forwarded-For alone (a bare `reverse_proxy <svc>:<port>`).
 * @param {string} address
 * @param {number} hop 0 is the socket peer
 */
export function trustCaddyHop(address, hop) {
  return hop === 0 && isPrivate(address, hop)
}
