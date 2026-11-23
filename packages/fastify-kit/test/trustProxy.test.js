import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'

import { trustCaddyHop } from '../index.js'

let app
afterEach(async () => {
  await app?.close()
  app = undefined
})

async function ipFor(injectOptions) {
  app = Fastify({ trustProxy: trustCaddyHop })
  app.get('/ip', async (request) => ({ ip: request.ip }))
  return (await app.inject({ method: 'GET', url: '/ip', ...injectOptions })).json().ip
}

describe('trustCaddyHop', () => {
  it('trusts only the immediate peer, and only on a private or loopback address', () => {
    expect(trustCaddyHop('172.18.0.5', 0)).toBe(true) // Caddy on the Docker network
    expect(trustCaddyHop('10.0.0.4', 0)).toBe(true)
    expect(trustCaddyHop('192.168.1.10', 0)).toBe(true)
    expect(trustCaddyHop('127.0.0.1', 0)).toBe(true)
    expect(trustCaddyHop('::1', 0)).toBe(true)
    expect(trustCaddyHop('fd00::5', 0)).toBe(true)
    expect(trustCaddyHop('169.254.1.1', 0)).toBe(true)

    expect(trustCaddyHop('172.18.0.5', 1)).toBe(false) // a second hop is never trusted
    expect(trustCaddyHop('203.0.113.9', 0)).toBe(false) // a client that reached the port directly
    expect(trustCaddyHop('2001:db8::1', 0)).toBe(false)
  })

  it('makes request.ip the address Caddy appended, ignoring anything a client prepended', async () => {
    // inject() connects from 127.0.0.1, standing in for Caddy.
    const ip = await ipFor({ headers: { 'x-forwarded-for': '1.2.3.4, 198.51.100.7' } })
    expect(ip).toBe('198.51.100.7')
  })

  it('ignores X-Forwarded-For from a peer that is not on the private network', async () => {
    const ip = await ipFor({ remoteAddress: '203.0.113.9', headers: { 'x-forwarded-for': '1.2.3.4' } })
    expect(ip).toBe('203.0.113.9')
  })
})
