# Changelog

Moved here from CoderizeDEV/coderize-platform (`packages/game-kit` at c60309c) and renamed `@coderizehq/game-kit`. The entries from 0.1.2 down are `@coderize/game-kit`'s, released from that repo with Changesets; its git history stays there.

## 0.1.2

### Patch Changes

- The Android plugin now builds: it declares `androidx.appcompat`, which Capacitor's `getActivity()` needs at compile time. 0.1.0 and 0.1.1 fail `bundleRelease` with "cannot access AppCompatActivity".

## 0.1.1

### Patch Changes

- Released through the release workflow from now on (0.1.0 was published by hand). No code changes.

## 0.1.0

### Minor Changes

- First release, for Sandy Streets, Train Track Puzzle and Railyard Out. `@coderize/game-kit/cloud-save`: `createCloudSave({ describe, merge })` keeps progress in a Google Play Games saved game with the games' rules (no write until a load has answered, a fresh read and the game's merge before every write, no write when that read fails or the player is signed out, one write at a time), plus the `CloudSave` Capacitor plugin for Android that `cap sync` registers, with the plugin name, the `progress` slot and the most-recently-modified conflict policy unchanged so existing saves carry over. `@coderize/game-kit/haptics`: `buzz()`. TypeScript types included.
