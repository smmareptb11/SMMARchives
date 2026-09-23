import type { Express } from 'express'

import type { ReplayCatalog } from '@smmarchives/worker/replay/catalog.ts'

import { notFound } from './problems.ts'
import { checkedReplayId } from './replays.ts'

export function registerJournal(app: Express, catalog: ReplayCatalog): void {
  app.get('/replays/:id/journal', async (req, res) => {
    const { id } = req.params
    if (!checkedReplayId(res, id)) return

    // Not through `openReplay`, which asks for a manifest: a build that died
    // before publishing one is the case this route exists for.
    const store = await catalog.open(id)
    if (store === undefined) {
      notFound(res, `no replay ${id}`)
      return
    }

    const entries = await store.readJournal(lineAskedFor(req.query.since))
    res.type('application/x-ndjson')
    res.send(entries.map((entry) => `${JSON.stringify(entry)}\n`).join(''))
  })
}

/**
 * Where to resume from, the whole journal being the answer to anything that is
 * not a line number.
 *
 * Lenient rather than refused: what a client that miscounted gets back is
 * everything it already has, never a gap it cannot see.
 */
function lineAskedFor(asked: unknown): number {
  const line = Number(asked)
  return Number.isInteger(line) && line > 0 ? line : 0
}
