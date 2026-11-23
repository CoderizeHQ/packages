# @coderizehq/game-kit

The pieces Coderize's three Capacitor games (Sandy Streets, Train Track Puzzle and Railyard Out) each carried a copy
of:

- **`@coderizehq/game-kit/cloud-save`**: progress kept in a Google Play Games saved game, so it follows the player's
  Google account to a new phone or a reinstall. The JavaScript side and the Android plugin that goes with it.
- **`@coderizehq/game-kit/haptics`**: `buzz()`, a short vibration on taps and big moments.

```bash
pnpm add @coderizehq/game-kit
```

Peer dependencies: `@capacitor/core` 8, and `@capacitor/haptics` 8 only for `/haptics`. Plain JavaScript (ESM) with
TypeScript types included. What a save holds, how two saves combine and what the game calls itself stay in each
game.

## Cloud save

```js
import { createCloudSave } from '@coderizehq/game-kit/cloud-save'

import { mergeProgress } from './game/progress.js'
import { LEVELS } from './game/levels.js'

// One per run, at module level.
const cloudSave = createCloudSave({
  describe: (save) => `Railyard Out: level ${save.unlocked}`,
  merge: (device, cloud) => mergeProgress(device, cloud, LEVELS.length),
})

const progress = mergeProgress(loadProgress(), await cloudSave.load(), LEVELS.length)

// After each win:
cloudSave.save(progress)
```

| Call                   | What it does                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createCloudSave(...)` | `describe(save)` names the save in Play Games. `merge(device, cloud)` combines this device's progress with the slot's. Both are required. `plugin` replaces the native one, for tests. |
| `load(timeout)`        | What the slot holds, or `null`: empty or unreadable, signed out, failed, slower than `timeout` ms (4000), or not on Android.                                                           |
| `save(progress)`       | Queues a write and returns at once.                                                                                                                                                    |

### What it guarantees

These are the rules the games already had; the package keeps each one, and its tests check them.

- **Nothing is written until a load has answered.** Before the first `load`, after a load that failed or timed out
  (even if the answer turns up later), or when the player was signed out at the load, `save` does nothing. The
  device save may be missing progress from another phone, and a write would replace that for good. The progress
  stays on the device, and the game's merge carries it to the cloud from a later run.
- **Every write merges with a fresh read.** The slot is read again just before each write and the game's
  `merge(device, cloud)` is stored, so a phone that read the cloud an hour ago can't replace what a tablet saved since.
- **No fresh read, no write.** If that read fails, or the player has signed out since, nothing is written; the next
  `save` tries again.
- **An empty or unreadable slot gets the device copy,** unmerged.
- **One write at a time.** A save that arrives while a write is open waits; a newer save replaces one still waiting.
- **Off Android it does nothing.** On the web and iOS `load` returns `null` and `save` returns without a call.

### The Android plugin

The package is a Capacitor plugin as well as a JavaScript module: `capacitor.android.src` in its `package.json`
points at `android/`, so `pnpm cap sync android` adds it to the game's Gradle build and lists `CloudSavePlugin` in
`capacitor.plugins.json`, and the bridge registers it. The game no longer calls `registerPlugin` for it.

It keeps what every player's existing save is stored under, byte for byte from the games:

- the plugin name, `@CapacitorPlugin(name = "CloudSave")`;
- the slot, `"progress"`;
- the conflict policy, `SnapshotsClient.RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED`.

Changing any of these loses every player's cloud progress. Only the Java package (`dev.coderize.cloudsave`) and the
fallback description, used only when none is sent, differ from the games' copies.

**Play Games SDK version.** The plugin declares `com.google.android.gms:play-services-games-v2` at
`playServicesGamesV2Version` from the game's `android/variables.gradle`, falling back to `22.1.0`, the version the
games use today. That is how Capacitor's own plugins take `compileSdkVersion` and the AndroidX versions. Gradle
resolves the plugin's and the game's declarations to one version either way; the variable keeps it a single number in
one place.

**`PlayGamesSdk.initialize` stays in the game's `MainActivity`.** It has to run before the bridge starts, and that
is the game's activity.

### Testing a game's merge with it

Pass a fake plugin and make the platform read as Android. Spy on the real `Capacitor` rather than
`vi.mock('@capacitor/core')`: Vitest doesn't run an installed package through the game's module mocks, so a mock
never reaches this package and every call quietly does nothing.

```js
import { Capacitor } from '@capacitor/core'

vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android')

let slot = ''
const plugin = {
  status: async () => ({ signedIn: true }),
  load: async () => ({ data: slot }),
  save: async ({ data }) => (slot = data),
}
const phone = createCloudSave({ describe, merge, plugin })
const tablet = createCloudSave({ describe, merge, plugin })
```

Two instances on one fake slot are two devices on one Play Games account. The package's own tests
(`test/cloudSave.test.js`) cover the queue and the guards; a game keeps only the tests of its own `mergeProgress`.

## Haptics

```js
import { buzz } from '@coderizehq/game-kit/haptics'

buzz() // light
buzz('medium')
buzz('heavy')
```

The native haptics engine (`@capacitor/haptics`) in the store apps, the vibration API (8, 16 or 30 ms) on the web
where there is one, and nothing otherwise. A native failure is swallowed. The game needs `@capacitor/haptics` in its
own dependencies, as it does today, so `cap sync` adds that plugin too.

## Moving a game onto it

One game at a time: move one, check it on the internal track (step 8), then the next. Use the package version that is
live on npm.

1. **Add the package:** `pnpm add @coderizehq/game-kit`.
2. **JavaScript.** In `src/main.js`, replace the import of `./lib/cloudSave.js` with one `createCloudSave` at module
   level, then `loadCloudProgress()` becomes `cloudSave.load()` and `saveCloudProgress(progress, merge)` becomes
   `cloudSave.save(progress)`:

   ```js
   const cloudSave = createCloudSave({
     describe: (save) => `Train Track Puzzle: level ${save.unlocked}`,
     merge: (local, saved) => mergeProgress(local, saved, LEVELS.length),
   })
   ```

   Sandy Streets passes `merge: mergeProgress` (its merge takes no level count). Keep the description text exactly
   as the game's `describe()` wrote it.

3. **Haptics** (Sandy Streets, Railyard Out): import `buzz` from `@coderizehq/game-kit/haptics` instead of
   `./lib/haptics.js`.
4. **Delete** what the package now holds:
   - `src/lib/cloudSave.js`;
   - `src/lib/haptics.js` (Sandy Streets, Railyard Out);
   - `test/cloudSave.test.js`. Move any test of the game's own merge (a start over, best result per level) into the
     game's progress tests if it isn't there already;
   - `android/app/src/main/java/dev/coderize/<game>/CloudSavePlugin.java`.
5. **`MainActivity.java`:** remove `registerPlugin(CloudSavePlugin.class);` and keep `PlayGamesSdk.initialize(this);`:

   ```java
   @Override
   public void onCreate(Bundle savedInstanceState) {
       // Play Games signs the player in by itself once the SDK is started.
       PlayGamesSdk.initialize(this);
       super.onCreate(savedInstanceState);
   }
   ```

   The bridge registers the package's plugin from `capacitor.plugins.json`, which `cap sync` writes.

6. **Gradle:** add `playServicesGamesV2Version = '22.1.0'` to `android/variables.gradle`, and in
   `android/app/build.gradle` change the Play Games line to
   `implementation "com.google.android.gms:play-services-games-v2:$playServicesGamesV2Version"`. The game still
   needs it there for `PlayGamesSdk` in `MainActivity`.
7. **Sync and build:** `pnpm build && pnpm cap sync android`. Check that `android/capacitor.settings.gradle` now
   includes `:coderize-game-kit` and that `android/app/src/main/assets/capacitor.plugins.json` lists
   `dev.coderize.cloudsave.CloudSavePlugin`. Bump `versionCode`.
8. **Test on the internal track, on a phone that already has a cloud save** from the current release:
   - install the signed internal-track build over the store version: the title shows the saved level, not level 1;
   - win a level, then check the save in Play Games (or clear the app's data and reopen it): the new level is there;
   - on a second device on the same account, open the game: it picks up that progress;
   - in a release with no Play Games account signed in, the game still starts and saves on the device.

   Only then promote it.

## What it doesn't do

- **The save's shape and the merge.** Each game's `progress.js` decides what a save holds and how two combine (a
  start over, the best result per level, coins). The package calls the merge; it never reads the save, except
  through `describe`.
- **The device save.** `localStorage` loading and saving stay in each game; their keys and shapes differ.
- **iOS.** There is no Game Center save yet; off Android every call does nothing.
- **Sign-in UI.** Play Games signs the player in by itself once `PlayGamesSdk.initialize` has run.
