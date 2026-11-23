import { getViteConfig } from 'astro/config'

// Astro's Vite config, so the tests can compile and render the .astro components through
// the container API. This package has no pages, so Astro's missing-pages warning is noise.
export default getViteConfig({ test: {} }, { logLevel: 'error' })
