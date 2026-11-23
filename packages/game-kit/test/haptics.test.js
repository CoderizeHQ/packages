import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ platform: false, impact: null }))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.platform } }))
vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: (...args) => native.impact(...args) },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' }
}))

// The module decides native or web once, when it loads, as it does in the game.
const load = async () => {
  vi.resetModules()
  return (await import('@coderize/game-kit/haptics')).buzz
}

describe('buzz', () => {
  beforeEach(() => {
    native.impact = vi.fn(async () => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the native haptics engine in the store apps, light by default', async () => {
    native.platform = true
    const buzz = await load()
    buzz()
    buzz('heavy')
    expect(native.impact.mock.calls).toEqual([[{ style: 'LIGHT' }], [{ style: 'HEAVY' }]])
  })

  it('swallows a native failure', async () => {
    native.platform = true
    native.impact = vi.fn(async () => {
      throw new Error('no vibrator')
    })
    const buzz = await load()
    expect(() => buzz('medium')).not.toThrow()
  })

  it('vibrates on the web where the device can', async () => {
    native.platform = false
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { vibrate })
    const buzz = await load()
    buzz()
    buzz('medium')
    buzz('heavy')
    expect(vibrate.mock.calls).toEqual([[8], [16], [30]])
    expect(native.impact).not.toHaveBeenCalled()
  })

  it('does nothing on the web without the vibration API', async () => {
    native.platform = false
    vi.stubGlobal('navigator', {})
    const buzz = await load()
    expect(() => buzz()).not.toThrow()
    expect(native.impact).not.toHaveBeenCalled()
  })
})
