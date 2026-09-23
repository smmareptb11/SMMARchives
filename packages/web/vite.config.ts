import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

/** Where `.env` is, which is the workspace root every other script reads it from. */
const WORKSPACE = join(import.meta.dirname, '..', '..')

export default defineConfig(({ mode }) => {
  /*
   * Everything `.env` holds, and not only what `VITE_` prefixes.
   *
   * These two ports are the API's and this server's own: nothing puts them in
   * a bundle, and a `define` is what would. Read here rather than left to the
   * command line, so that starting the interface takes no flag to remember —
   * a missing one sent this server to another port, proxying to an API that
   * was not there, and the page it served was silent about both.
   */
  const env = loadEnv(mode, WORKSPACE, '')

  /**
   * One origin, in development as in production.
   *
   * The API carries no CORS header and has none to carry: behind the reverse
   * proxy, one host serves this bundle and forwards these two paths to the
   * API. This reproduces that, so nothing here depends on an arrangement
   * production will not have.
   *
   * `API_PORT` is the API's own variable, read here so the two agree without a
   * second one to keep in step.
   */
  const api = `http://localhost:${env['API_PORT'] ?? '3000'}`

  return {
    root: import.meta.dirname,
    /**
     * MapLibre loads its tiles from a web worker, and the dependency
     * pre-bundler breaks it: the style and the sprite arrive, no tile is ever
     * requested, and nothing is logged. Left alone, the library ships its own
     * worker and the map draws.
     */
    optimizeDeps: { exclude: ['maplibre-gl'] },
    server: {
      port: Number(env['WEB_PORT'] ?? '5180'),
      // Fail rather than slide onto the next free port: the address is what a
      // browser tab, a screenshot and a bug report all name.
      strictPort: true,
      proxy: { '/replays': api, '/health': api },
    },
    plugins: [react()],
  }
})
