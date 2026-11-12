import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')

/**
 * What only a production bundle shows: the development server reads MapLibre
 * from `node_modules`, where its worker sits beside it whatever the bundle
 * holds.
 */
describe('the bundle a deployment serves', () => {
  let out: string
  let assets: string[]

  beforeAll(async () => {
    out = await mkdtemp(join(tmpdir(), 'smmarchives-bundle-'))
    await build({
      root: ROOT,
      configFile: join(ROOT, 'vite.config.ts'),
      logLevel: 'silent',
      build: { outDir: out, emptyOutDir: true },
    })
    assets = await readdir(join(out, 'assets'))
  }, 120_000)

  afterAll(async () => {
    await rm(out, { recursive: true, force: true })
  })

  /** Without it, the style arrives and no tile is ever drawn. */
  it('holds the worker that draws the map, whole', async () => {
    const worker = assets.find(
      (name) => name.startsWith('maplibre-gl-worker') && name.endsWith('.js'),
    )
    expect(worker).toBeDefined()

    const code = await readFile(join(out, 'assets', worker ?? ''), 'utf8')
    expect(code).not.toMatch(/from\s*["']\.\/maplibre-gl-shared\.mjs["']/)
  })
})
