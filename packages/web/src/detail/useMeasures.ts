import { useEffect, useState } from 'react'

import type { Quantity } from '@smmarchives/shared/contracts/quantity.ts'

import { api } from '../api.ts'
import { describe } from '../problems.ts'
import { seriesOf, type Series } from './series.ts'

export type Measured = { series: Series | undefined; failure: string | undefined }

const READING: Measured = { series: undefined, failure: undefined }

/**
 * What a station measured over the period, read when its bubble opens.
 *
 * Station by station, and on the replay's period alone: three kilobytes, where
 * the whole parc is nineteen megabytes. That the API narrows on the source and
 * the quantity is what makes this affordable at all.
 *
 * Neither a series nor a failure while it is being read, so the bubble can say
 * so rather than show a value it does not have yet.
 */
export function useMeasures(replayId: string, sourceId: number, quantity: Quantity): Measured {
  const [measured, setMeasured] = useState<Measured>(READING)

  useEffect(() => {
    const leaving = new AbortController()
    setMeasured(READING)

    void read(replayId, sourceId, quantity, leaving.signal).then((next) => {
      // A bubble closed while its measures were coming drops the request, and
      // what comes back says nothing to anyone still reading.
      if (!leaving.signal.aborted) setMeasured(next)
    })

    return () => {
      leaving.abort()
    }
  }, [replayId, sourceId, quantity])

  return measured
}

async function read(
  replayId: string,
  sourceId: number,
  quantity: Quantity,
  signal: AbortSignal,
): Promise<Measured> {
  try {
    const measures = await api.measuresOf(replayId, sourceId, quantity, signal)
    return { series: seriesOf(measures, sourceId, quantity), failure: undefined }
  } catch (error: unknown) {
    return { series: undefined, failure: describe(error) }
  }
}
