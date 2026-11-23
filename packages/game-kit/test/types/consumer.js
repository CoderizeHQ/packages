// Type-checked by `tsc -p test/types` in `pnpm test` (checkJs), as a game checked with JSDoc (or written in
// TypeScript) would import the package. Nothing here runs.
import { createCloudSave } from '@coderizehq/game-kit/cloud-save'
import { buzz } from '@coderizehq/game-kit/haptics'

/** @import { CloudSave, CloudSavePlugin } from '@coderizehq/game-kit/cloud-save' */
/** @import { BuzzStrength } from '@coderizehq/game-kit/haptics' */

/** @typedef {{ level: number, unlocked: number, results: Record<string, { stars: number, bestBumps: number }> }} Progress */

/**
 * The game's own merge and load, stubbed: only their types matter here.
 * @param {Progress} local
 * @param {Progress | null} saved
 * @param {number} _levelCount
 * @returns {Progress}
 */
const mergeProgress = (local, saved, _levelCount) => saved ?? local
/** @returns {Progress} */
const loadProgress = () => ({ level: 1, unlocked: 1, results: {} })

/** @type {CloudSave<Progress>} */
const cloudSave = createCloudSave({
  describe: (/** @type {Progress} */ save) => `Railyard Out: level ${save.unlocked}`,
  merge: (/** @type {Progress} */ local, saved) => mergeProgress(local, saved, 99),
})

/** @returns {Promise<number>} */
export async function start() {
  /** @type {Progress | null} */
  const saved = await cloudSave.load()
  const quick = await cloudSave.load(1000)
  const progress = mergeProgress(loadProgress(), saved ?? quick, 99)
  /** @type {void} */
  const nothing = cloudSave.save(progress)
  // @ts-expect-error save takes the game's progress shape
  cloudSave.save({ unlocked: 'seven' })
  return progress.unlocked + (nothing === undefined ? 0 : 1)
}

// Without a type for the save, it is a plain record.
const untyped = createCloudSave({
  describe: (save) => `Sandy Streets: level ${String(save.unlocked)}`,
  merge: (device, cloud) => ({ ...cloud, ...device }),
})
untyped.save({ unlocked: 3 })

// A test double for the native plugin.
/** @type {CloudSavePlugin} */
const fake = {
  status: async () => ({ signedIn: true }),
  load: async () => ({ data: '' }),
  save: async () => {},
}
createCloudSave({ describe: () => 'x', merge: (/** @type {Progress} */ device) => device, plugin: fake })

// @ts-expect-error merge is required: the game owns how two saves combine
createCloudSave({ describe: () => 'x' })

/** @type {BuzzStrength} */
const strength = 'medium'
buzz()
buzz(strength)
// @ts-expect-error only light, medium and heavy
buzz('loud')
