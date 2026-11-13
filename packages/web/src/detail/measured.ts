import type { Quantity } from '@smmarchives/shared/contracts/quantity.ts'

import type { Series } from './series.ts'

export type Measured = { series: Series | undefined; failure: string | undefined }

const READING: Measured = { series: undefined, failure: undefined }

/** What was read, and for which source and quantity of which replay. */
export type Held = Measured & { replayId: string; sourceId: number; quantity: Quantity }

/**
 * What was read, if it is what is asked for now; being read otherwise, or a
 * switch of quantity would show for one frame the level under the flow button.
 */
export function measuredFor(
  held: Held | undefined,
  { replayId, sourceId, quantity }: Omit<Held, keyof Measured>,
): Measured {
  if (
    held === undefined ||
    held.replayId !== replayId ||
    held.sourceId !== sourceId ||
    held.quantity !== quantity
  ) {
    return READING
  }
  return { series: held.series, failure: held.failure }
}
