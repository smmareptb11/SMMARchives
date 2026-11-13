import { useEffect, useState } from 'react'

import type { Quantity } from '@smmarchives/shared/contracts/quantity.ts'

import { api } from '../api.ts'
import { describe } from '../problems.ts'
import { measuredFor, type Held, type Measured } from './measured.ts'
import { seriesOf } from './series.ts'

/**
 * What a station measured over the period, read when its window opens and
 * whenever the quantity shown changes: station by station, the whole parc being
 * far too heavy. Neither a series nor a failure while it is being read.
 */
export function useMeasures(replayId: string, sourceId: number, quantity: Quantity): Measured {
  const [held, setHeld] = useState<Held | undefined>(undefined)

  useEffect(() => {
    const leaving = new AbortController()

    void read(replayId, sourceId, quantity, leaving.signal).then((next) => {
      // A window closed or switched meanwhile has dropped the request.
      if (!leaving.signal.aborted) setHeld({ ...next, replayId, sourceId, quantity })
    })

    return () => {
      leaving.abort()
    }
  }, [replayId, sourceId, quantity])

  return measuredFor(held, { replayId, sourceId, quantity })
}

async function read(
  replayId: string,
  sourceId: number,
  quantity: Quantity,
  signal: AbortSignal,
): Promise<Measured> {
  try {
    const measures = await api.stationMeasuresOf(replayId, sourceId, quantity, signal)
    return { series: seriesOf(measures, sourceId, quantity), failure: undefined }
  } catch (error: unknown) {
    return { series: undefined, failure: describe(error) }
  }
}
