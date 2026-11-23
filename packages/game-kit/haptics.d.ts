export type BuzzStrength = 'light' | 'medium' | 'heavy'

/** A short buzz: the native haptics engine in the store apps, the vibration API on the web where there is one. */
export declare function buzz(strength?: BuzzStrength): void
