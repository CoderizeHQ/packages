import { astro, node } from '@coderizehq/config/eslint'

// @coderizehq/astro-kit ships .astro components, so its folder also gets the astro preset, every block scoped to it.
// The preset's ignores-only block applies as it is.
const astroKit = astro.map((config) => {
  if (Object.keys(config).length === 1 && config.ignores) return config
  const files = config.files ? config.files.map((glob) => `packages/astro-kit/${glob}`) : ['packages/astro-kit/**']
  return { ...config, files }
})

export default [...node, ...astroKit]
