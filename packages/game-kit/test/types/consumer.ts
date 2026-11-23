// Type-checked by `tsc -p test/types` in `pnpm test`, as a game written in TypeScript (or checked with JSDoc)
// would import the package. Nothing here runs.
import { createCloudSave, type CloudSave, type CloudSavePlugin } from '@coderize/game-kit/cloud-save'
import { buzz, type BuzzStrength } from '@coderize/game-kit/haptics'

interface Progress {
  level: number
  unlocked: number
  results: Record<string, { stars: number; bestBumps: number }>
}

declare function mergeProgress(local: Progress, saved: Progress | null, levelCount: number): Progress
declare function loadProgress(): Progress

const cloudSave: CloudSave<Progress> = createCloudSave<Progress>({
  describe: (save) => `Railyard Out: level ${save.unlocked}`,
  merge: (local, saved) => mergeProgress(local, saved, 99)
})

export async function start(): Promise<number> {
  const saved: Progress | null = await cloudSave.load()
  const quick = await cloudSave.load(1000)
  const progress = mergeProgress(loadProgress(), saved ?? quick, 99)
  const nothing: void = cloudSave.save(progress)
  // @ts-expect-error save takes the game's progress shape
  cloudSave.save({ unlocked: 'seven' })
  return progress.unlocked + (nothing === undefined ? 0 : 1)
}

// Without a type argument the save is a plain record.
const untyped = createCloudSave({
  describe: (save) => `Sandy Streets: level ${String(save.unlocked)}`,
  merge: (device, cloud) => ({ ...cloud, ...device })
})
untyped.save({ unlocked: 3 })

// A test double for the native plugin.
const fake: CloudSavePlugin = {
  status: async () => ({ signedIn: true }),
  load: async () => ({ data: '' }),
  save: async () => {}
}
createCloudSave<Progress>({ describe: () => 'x', merge: (device) => device, plugin: fake })

// @ts-expect-error merge is required: the game owns how two saves combine
createCloudSave<Progress>({ describe: () => 'x' })

const strength: BuzzStrength = 'medium'
buzz()
buzz(strength)
// @ts-expect-error only light, medium and heavy
buzz('loud')
