/** The native side, as `registerPlugin('CloudSave')` returns it. Pass your own only in tests. */
export interface CloudSavePlugin {
  status(): Promise<{ signedIn: boolean }>
  /** The slot's JSON text, or an empty string when it holds nothing yet. */
  load(): Promise<{ data: string }>
  save(options: { data: string; description: string }): Promise<void>
}

export interface CloudSaveOptions<Save> {
  /** The saved game's description in Play Games, e.g. `Railyard Out: level ${save.unlocked}`. */
  describe(save: Save): string
  /** Combines this device's progress with what the slot holds now. Runs before every write. */
  merge(device: Save, cloud: Save): Save
  /** Replaces the native `CloudSave` plugin, for tests. */
  plugin?: CloudSavePlugin
}

export interface CloudSave<Save> {
  /**
   * What the slot holds, or `null` when it is empty or unreadable, the player is signed out, it fails, it takes longer
   * than `timeout` milliseconds (4000 by default), or the game isn't running on Android. Until a load has answered,
   * `save` writes nothing.
   */
  load(timeout?: number): Promise<Save | null>
  /**
   * Queues a write of `progress`, merged with a fresh read of the slot. Writes nothing when the last load didn't answer,
   * the player is signed out, or the fresh read fails. Returns at once; the write happens in the background.
   */
  save(progress: Save): void
}

/** Play Games saved-game sync for one game. Make one per run, at module level. */
export declare function createCloudSave<Save = Record<string, unknown>>(
  options: CloudSaveOptions<Save>
): CloudSave<Save>
