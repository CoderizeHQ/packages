import { Capacitor, registerPlugin } from '@capacitor/core'

// Progress kept in a Google Play Games saved game (android/.../CloudSavePlugin.java), so it
// follows the player's Google account. Only the Android app has it; elsewhere every call
// quietly does nothing and the save stays on the device.
//
// The native plugin's name ("CloudSave"), its slot ("progress") and its conflict policy are what
// every player's existing save is stored under. Changing any of them loses those saves.
const PLUGIN_NAME = 'CloudSave'

// Registered once, on first use, so importing the module touches nothing native.
let nativePlugin = null
const defaultPlugin = () => (nativePlugin ??= registerPlugin(PLUGIN_NAME))

const available = () => Capacitor.getPlatform() === 'android'

// A save this game can't read counts as no save, so the next write replaces it.
function parseSave(data) {
  try {
    return data ? JSON.parse(data) : null
  } catch {
    return null
  }
}

/**
 * One game's cloud save. `describe(save)` names the save in Play Games ("Railyard Out: level 7");
 * `merge(device, cloud)` combines this device's progress with what the slot holds. Both stay in
 * the game. Make one per run: a second instance has its own read guard and write queue.
 */
export function createCloudSave({ describe, merge, plugin } = {}) {
  if (typeof describe !== 'function') throw new TypeError('createCloudSave needs a describe(save) function')
  if (typeof merge !== 'function') throw new TypeError('createCloudSave needs a merge(device, cloud) function')
  const cloudSave = () => plugin ?? defaultPlugin()

  // Whether this run has seen what the cloud holds. Until it has, nothing is written: the device
  // save may be missing progress from another phone, and a write would replace that for good.
  // A start over waits too: it stays on the device, and the game's merge carries it through at a
  // later start.
  let cloudRead = false

  // Saves are queued so only one write is open at a time; a newer save replaces any that hasn't
  // started yet. Every write reads the slot first and stores `merge(device, cloud)`, so a session
  // that read the cloud long ago can't replace progress another device saved since.
  let writing = null
  let pending = null

  // The saved progress, or null when there is none, the player isn't signed in to Play Games,
  // or it doesn't answer within `timeout` milliseconds.
  async function load(timeout = 4000) {
    if (!available()) return null
    const attempt = (async () => {
      const { signedIn } = await cloudSave().status()
      if (!signedIn) return null
      const { data } = await cloudSave().load()
      return { save: parseSave(data) }
    })().catch(() => null)
    const giveUp = new Promise((resolve) => setTimeout(() => resolve(null), timeout))
    const answer = await Promise.race([attempt, giveUp])
    cloudRead = answer !== null
    return answer?.save ?? null
  }

  function save(progress) {
    if (!available() || !cloudRead) return
    pending = JSON.stringify(progress)
    if (!writing) writing = flush()
  }

  async function flush() {
    while (pending) {
      const data = pending
      pending = null
      try {
        const { signedIn } = await cloudSave().status()
        if (!signedIn) continue
        const cloud = parseSave((await cloudSave().load()).data)
        const combined = cloud ? JSON.stringify(merge(JSON.parse(data), cloud)) : data
        await cloudSave().save({ data: combined, description: describe(JSON.parse(combined)) })
      } catch {
        // Offline or signed out: the next save tries again. Nothing is written without a fresh read.
      }
    }
    writing = null
  }

  return { load, save }
}
