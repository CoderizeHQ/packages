import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The native plugin, as `registerPlugin('CloudSave')` hands it to the module.
const plugin = vi.hoisted(() => ({ status: vi.fn(), load: vi.fn(), save: vi.fn() }))
const capacitor = vi.hoisted(() => ({ platform: 'android', registerPlugin: null }))

vi.mock('@capacitor/core', () => {
  capacitor.registerPlugin = vi.fn(() => plugin)
  return {
    Capacitor: { getPlatform: () => capacitor.platform },
    registerPlugin: (...args) => capacitor.registerPlugin(...args)
  }
})

const { createCloudSave } = await import('@coderize/game-kit/cloud-save')

// A game's merge, cut down to what the tests need. A start over raises `epoch`, and the higher
// epoch wins outright; within one epoch the furthest unlock and the best stars per level win, and
// the rest (the level being played, savedAt) comes from the device.
function merge(device, cloud) {
  const deviceEpoch = device.epoch ?? 0
  const cloudEpoch = cloud.epoch ?? 0
  if (deviceEpoch !== cloudEpoch) return deviceEpoch > cloudEpoch ? device : cloud
  const stars = { ...cloud.stars }
  for (const [level, best] of Object.entries(device.stars ?? {})) stars[level] = Math.max(best, stars[level] ?? 0)
  return { ...device, unlocked: Math.max(device.unlocked, cloud.unlocked), stars }
}

const describeSave = (save) => `Test Game: level ${save.unlocked}`
const fresh = (epoch = 0) => ({ epoch, level: 1, unlocked: 1, stars: {} })

const never = () => new Promise(() => {})
const settle = () => vi.advanceTimersByTimeAsync(0)
// A new run of the game: on another phone, or the same phone after a restart.
const newSession = () => createCloudSave({ describe: describeSave, merge })

describe('cloud save', () => {
  let cloud

  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    capacitor.registerPlugin.mockImplementation(() => plugin)
    capacitor.platform = 'android'
    plugin.status.mockResolvedValue({ signedIn: true })
    plugin.load.mockResolvedValue({ data: '' })
    plugin.save.mockResolvedValue(undefined)
    cloud = newSession()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('setup', () => {
    it('needs describe and merge from the game', () => {
      expect(() => createCloudSave()).toThrow(TypeError)
      expect(() => createCloudSave({ merge })).toThrow(/describe/)
      expect(() => createCloudSave({ describe: describeSave })).toThrow(/merge/)
    })

    it('registers the native plugin named CloudSave, the name every existing save is under, on first use', async () => {
      vi.resetModules()
      const module = await import('@coderize/game-kit/cloud-save')
      const session = module.createCloudSave({ describe: describeSave, merge })
      expect(capacitor.registerPlugin).not.toHaveBeenCalled()
      await session.load()
      module.createCloudSave({ describe: describeSave, merge }).load()
      await settle()
      expect(capacitor.registerPlugin).toHaveBeenCalledExactlyOnceWith('CloudSave')
    })

    it('uses a plugin it is given instead', async () => {
      const own = {
        status: vi.fn(async () => ({ signedIn: true })),
        load: vi.fn(async () => ({ data: '{"unlocked":3}' }))
      }
      expect(await createCloudSave({ describe: describeSave, merge, plugin: own }).load()).toEqual({ unlocked: 3 })
      expect(own.load).toHaveBeenCalledOnce()
      expect(plugin.load).not.toHaveBeenCalled()
    })
  })

  it('does nothing off Android', async () => {
    capacitor.platform = 'web'
    expect(await cloud.load()).toBeNull()
    cloud.save({ unlocked: 3 })
    await settle()
    for (const call of Object.values(plugin)) expect(call).not.toHaveBeenCalled()
  })

  describe('loading', () => {
    it('returns the saved progress', async () => {
      plugin.load.mockResolvedValue({ data: '{"unlocked":7}' })
      expect(await cloud.load()).toEqual({ unlocked: 7 })
    })

    it('treats an empty or unreadable slot as no save', async () => {
      expect(await cloud.load()).toBeNull()
      plugin.load.mockResolvedValue({ data: 'not json' })
      expect(await cloud.load()).toBeNull()
    })

    it('leaves the cloud alone when the player is signed out', async () => {
      plugin.status.mockResolvedValue({ signedIn: false })
      expect(await cloud.load()).toBeNull()
      expect(plugin.load).not.toHaveBeenCalled()
    })

    it('gives up on a load that fails', async () => {
      plugin.load.mockRejectedValue(new Error('offline'))
      expect(await cloud.load()).toBeNull()
    })

    it('stops waiting after 4 seconds', async () => {
      plugin.status.mockImplementation(never)
      const loaded = vi.fn()
      cloud.load().then(loaded)
      await vi.advanceTimersByTimeAsync(3999)
      expect(loaded).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(loaded).toHaveBeenCalledWith(null)
    })

    it('takes its own timeout', async () => {
      plugin.status.mockImplementation(never)
      const loaded = vi.fn()
      cloud.load(500).then(loaded)
      await vi.advanceTimersByTimeAsync(500)
      expect(loaded).toHaveBeenCalledWith(null)
    })
  })

  describe('saving', () => {
    beforeEach(() => cloud.load())

    it("writes the save with the game's own description", async () => {
      cloud.save({ level: 4, unlocked: 7 })
      await settle()
      expect(plugin.save).toHaveBeenCalledExactlyOnceWith({
        data: '{"level":4,"unlocked":7}',
        description: 'Test Game: level 7'
      })
    })

    it('does not write when the player has signed out since the load', async () => {
      plugin.status.mockResolvedValue({ signedIn: false })
      cloud.save({ unlocked: 2 })
      await settle()
      expect(plugin.save).not.toHaveBeenCalled()
    })

    it('runs one write at a time, with only the newest save waiting', async () => {
      let finish
      plugin.save.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      cloud.save({ unlocked: 2 })
      await settle()
      cloud.save({ unlocked: 3 })
      cloud.save({ unlocked: 4 })
      await settle()
      expect(plugin.save).toHaveBeenCalledOnce()
      finish()
      await settle()
      expect(plugin.save.mock.calls.map(([call]) => call.description)).toEqual([
        'Test Game: level 2',
        'Test Game: level 4'
      ])
    })

    it('reads the slot afresh for each queued write, never during another', async () => {
      const events = []
      plugin.load.mockImplementation(async () => {
        events.push('read')
        return { data: '' }
      })
      let finish
      plugin.save.mockImplementationOnce(() => {
        events.push('write 2')
        return new Promise((resolve) => (finish = resolve))
      })
      plugin.save.mockImplementation(async ({ data }) => events.push(`write ${JSON.parse(data).unlocked}`))
      cloud.save({ unlocked: 2 })
      await settle()
      cloud.save({ unlocked: 3 })
      await settle()
      expect(events).toEqual(['read', 'write 2'])
      finish()
      await settle()
      expect(events).toEqual(['read', 'write 2', 'read', 'write 3'])
    })

    it('keeps going after a write that fails', async () => {
      plugin.save.mockRejectedValueOnce(new Error('offline'))
      cloud.save({ unlocked: 2 })
      await settle()
      cloud.save({ unlocked: 3 })
      await settle()
      expect(plugin.save).toHaveBeenCalledTimes(2)
    })

    it('writes nothing when describe throws, and keeps going', async () => {
      const broken = createCloudSave({
        describe: () => {
          throw new Error('bad save')
        },
        merge
      })
      await broken.load()
      broken.save({ unlocked: 2 })
      await settle()
      expect(plugin.save).not.toHaveBeenCalled()
      cloud.save({ unlocked: 3 })
      await settle()
      expect(plugin.save).toHaveBeenCalledOnce()
    })
  })

  describe('never replaces a cloud save it has not seen', () => {
    it('before any load', async () => {
      cloud.save({ unlocked: 2 })
      await settle()
      expect(plugin.save).not.toHaveBeenCalled()
    })

    it('when the load fails', async () => {
      plugin.load.mockRejectedValue(new Error('offline'))
      await cloud.load()
      cloud.save({ unlocked: 2 })
      await settle()
      expect(plugin.save).not.toHaveBeenCalled()
    })

    it('when the player was signed out at the load, even after signing in', async () => {
      plugin.status.mockResolvedValueOnce({ signedIn: false })
      await cloud.load()
      cloud.save({ unlocked: 2 })
      await settle()
      expect(plugin.save).not.toHaveBeenCalled()
    })

    it('when the answer came after the timeout', async () => {
      let answer
      plugin.load.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
      const loading = cloud.load()
      await vi.advanceTimersByTimeAsync(4000)
      expect(await loading).toBeNull()
      answer({ data: '{"unlocked":50}' })
      await settle()
      cloud.save({ unlocked: 2 })
      await settle()
      expect(plugin.save).not.toHaveBeenCalled()
    })

    it('but writes the device copy over an empty slot', async () => {
      await cloud.load()
      cloud.save({ unlocked: 2 })
      await settle()
      expect(plugin.save).toHaveBeenCalledExactlyOnceWith({ data: '{"unlocked":2}', description: 'Test Game: level 2' })
    })

    it('and writes the device copy over a slot it could not read, without merging', async () => {
      const spy = vi.fn(merge)
      const session = createCloudSave({ describe: describeSave, merge: spy })
      plugin.load.mockResolvedValue({ data: 'not json' })
      expect(await session.load()).toBeNull()
      session.save({ unlocked: 2 })
      await settle()
      expect(spy).not.toHaveBeenCalled()
      expect(plugin.save).toHaveBeenCalledExactlyOnceWith({ data: '{"unlocked":2}', description: 'Test Game: level 2' })
    })
  })

  describe('two devices on one Play Games account', () => {
    // One saved-game slot shared by every device on the account.
    const useSlot = (initial) => {
      let slot = JSON.stringify(initial)
      plugin.load.mockImplementation(async () => ({ data: slot }))
      plugin.save.mockImplementation(async ({ data }) => {
        slot = data
      })
      return () => JSON.parse(slot)
    }
    const at = (savedAt, fields) => ({ ...fresh(), ...fields, savedAt })
    const wins = (progress, through) => {
      const stars = { ...progress.stars }
      for (let n = progress.unlocked; n <= through; n++) stars[n] = 3
      return { ...progress, level: through + 1, unlocked: through + 1, stars }
    }

    it("keeps the other device's newer progress when a session that read the cloud long ago saves", async () => {
      const slot = useSlot(at(1))
      const phone = cloud
      const phoneProgress = merge(fresh(), await phone.load())

      const tablet = newSession()
      const tabletProgress = merge(fresh(), await tablet.load())
      tablet.save(at(2, wins(tabletProgress, 10)))
      await settle()
      expect(slot().unlocked).toBe(11)

      phone.save(at(3, wins(phoneProgress, 2)))
      await settle()
      expect(slot()).toMatchObject({ unlocked: 11, level: 3, savedAt: 3 })
      expect(Object.keys(slot().stars)).toHaveLength(10)
      expect(plugin.save.mock.lastCall[0].description).toBe('Test Game: level 11')

      const newInstall = newSession()
      expect(merge(fresh(), await newInstall.load()).unlocked).toBe(11)
    })

    it('keeps the best result per level from both devices', async () => {
      const slot = useSlot(at(1, { unlocked: 2, stars: { 1: 3 } }))
      await cloud.load()
      cloud.save(at(2, { unlocked: 2, stars: { 1: 1 } }))
      await settle()
      expect(slot().stars[1]).toBe(3)
    })

    it("doesn't let a stale device undo another device's start over", async () => {
      const slot = useSlot(at(1, { level: 40, unlocked: 40 }))
      const stale = cloud
      const staleProgress = merge(fresh(), await stale.load())

      const other = newSession()
      const otherProgress = merge(fresh(), await other.load())
      other.save(at(2, fresh(otherProgress.epoch + 1)))
      await settle()
      expect(slot()).toMatchObject({ epoch: 1, unlocked: 1 })

      stale.save(at(3, wins(staleProgress, 40)))
      await settle()
      expect(slot()).toMatchObject({ epoch: 1, level: 1, unlocked: 1, stars: {} })
    })

    it('writes nothing when the fresh read before the write fails', async () => {
      const slot = useSlot(at(1, { unlocked: 9 }))
      await cloud.load()
      plugin.load.mockRejectedValueOnce(new Error('offline'))
      cloud.save(at(2, { unlocked: 5 }))
      await settle()
      expect(plugin.save).not.toHaveBeenCalled()
      expect(slot().unlocked).toBe(9)
    })

    it('keeps a start over on the device when the load failed, and lands it from a later session', async () => {
      const slot = useSlot(at(1, { level: 40, unlocked: 40 }))
      plugin.load.mockRejectedValueOnce(new Error('offline'))
      await cloud.load()
      const device = at(10, fresh(1))
      cloud.save(device)
      await settle()
      expect(plugin.save).not.toHaveBeenCalled()

      const next = newSession()
      const merged = merge(device, await next.load())
      expect(merged).toEqual(device)
      next.save(merged)
      await settle()
      expect(slot()).toMatchObject({ epoch: 1, unlocked: 1 })
    })
  })
})
