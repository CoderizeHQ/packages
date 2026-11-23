import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startServer } from '../index.js'
import { appWithLogs } from './helpers.js'

const apps = []
let exit
// Resolves the onClose hook a test holds open.
let release

beforeEach(() => {
  exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined)
})

afterEach(async () => {
  release = undefined
  vi.unstubAllEnvs()
  exit.mockRestore()
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

function newApp() {
  const logs = appWithLogs()
  logs.app.get('/', async () => ({ ok: true }))
  apps.push(logs.app)
  return logs
}

/** The listener startServer added for a signal. Called directly: emitting a real signal would reach the test runner too. */
function addedListener(signal, before) {
  const added = process.listeners(signal).filter((listener) => !before.includes(listener))
  expect(added).toHaveLength(1)
  return added[0]
}

const waitForExit = () => vi.waitFor(() => expect(exit).toHaveBeenCalled())

// Lets a close held open by a test's onClose hook finish, so nothing outlives the test.
async function finishClosing() {
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  release()
  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
}

describe('startServer', () => {
  it('listens on PORT and HOST from the environment', async () => {
    vi.stubEnv('PORT', '0')
    vi.stubEnv('HOST', '127.0.0.1')
    const { app } = newApp()

    const address = await startServer(app)

    expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect((await fetch(address)).status).toBe(200)
  })

  it('closes the app on SIGTERM and exits 0', async () => {
    const before = process.listeners('SIGTERM')
    const logs = newApp()
    const closed = vi.fn()
    logs.app.addHook('onClose', async () => closed())
    await startServer(logs.app, { port: 0, host: '127.0.0.1' })

    addedListener('SIGTERM', before)('SIGTERM')
    await waitForExit()

    expect(closed).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)
    expect(logs.app.server.listening).toBe(false)
    expect(logs.lines.find((l) => l.msg === 'shutting down')).toMatchObject({ signal: 'SIGTERM' })
    // Closing removed its listeners.
    expect(process.listeners('SIGTERM')).toEqual(before)
  })

  it('handles SIGINT the same way', async () => {
    const before = process.listeners('SIGINT')
    const { app } = newApp()
    await startServer(app, { port: 0, host: '127.0.0.1' })

    addedListener('SIGINT', before)('SIGINT')
    await waitForExit()

    expect(exit).toHaveBeenCalledWith(0)
  })

  it('exits 1 when closing outlasts the timeout', async () => {
    const before = process.listeners('SIGTERM')
    const logs = newApp()
    logs.app.addHook('onClose', () => new Promise((resolve) => (release = resolve)))
    await startServer(logs.app, { port: 0, host: '127.0.0.1', shutdownTimeoutMs: 20 })

    addedListener('SIGTERM', before)('SIGTERM')
    await waitForExit()

    expect(exit).toHaveBeenCalledWith(1)
    expect(logs.lines.some((l) => l.msg === 'shutdown timed out: exiting')).toBe(true)
    await finishClosing()
  })

  it('exits 1 at once on a second signal', async () => {
    const before = process.listeners('SIGTERM')
    const logs = newApp()
    logs.app.addHook('onClose', () => new Promise((resolve) => (release = resolve)))
    await startServer(logs.app, { port: 0, host: '127.0.0.1' })

    const onSignal = addedListener('SIGTERM', before)
    onSignal('SIGTERM')
    onSignal('SIGTERM')

    expect(exit).toHaveBeenCalledWith(1)
    await finishClosing()
  })

  it('logs a failed listen and exits 1', async () => {
    const first = newApp()
    const address = await startServer(first.app, { port: 0, host: '127.0.0.1' })
    const port = Number(new URL(address).port)
    const before = process.listeners('SIGTERM')

    const second = newApp()
    await startServer(second.app, { port, host: '127.0.0.1' })

    expect(exit).toHaveBeenCalledWith(1)
    expect(second.lines.find((l) => l.msg === 'failed to start')?.error).toMatchObject({ code: 'EADDRINUSE' })
    expect(process.listeners('SIGTERM')).toEqual(before)
  })

  it('refuses a port that is not a port', async () => {
    vi.stubEnv('PORT', 'eighty')
    const app = Fastify()
    apps.push(app)

    await expect(startServer(app)).rejects.toThrow(TypeError)
  })
})
