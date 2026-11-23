import { defineConfig } from 'vitest/config'

// Every suite runs three times, with the process in a different zone: UTC (CI and the APIs),
// America/Detroit (the clients) and Asia/Kolkata (+05:30, no daylight saving, and a half-hour
// offset). Nothing in the package may depend on the zone it runs in, and this is how that is
// checked. Node applies a TZ set in a worker's environment before the tests import anything.
const ZONES = ['UTC', 'America/Detroit', 'Asia/Kolkata']

export default defineConfig({
  test: {
    projects: ZONES.map((zone) => ({
      extends: true,
      test: { name: zone, env: { TZ: zone } },
    })),
  },
})
