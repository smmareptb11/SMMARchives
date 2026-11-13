import {
  sandreToWgs84,
  type BoundingBox,
  type Position,
  type ReportCollector,
} from '@smmarchives/shared'

type PositionedRow = {
  id: number
  x?: number | undefined
  y?: number | undefined
}

/**
 * Places a source on the map, reporting rather than guessing when it cannot.
 * The row's own Sandre code decides the transform, never its family: rain
 * gauges come both in Lambert 93 and in degrees.
 */
/* eslint-disable-next-line max-params -- five values, none derivable from another, and the last
   decides omit or drop */
export function positionOf(
  row: PositionedRow,
  sandreCode: number | undefined,
  subject: string,
  collector: ReportCollector,
  /** Given, a source that cannot be placed leaves the collection entirely. */
  extent?: BoundingBox,
): Position | null {
  if (row.x === undefined || row.y === undefined || sandreCode === undefined) {
    collector.fellBackTo({
      subject,
      rule: 'no usable coordinates in the referential',
      applied: extent === undefined ? 'position omitted' : 'source dropped, an extent was given',
    })
    return null
  }
  try {
    return sandreToWgs84(row.x, row.y, sandreCode)
  } catch (error) {
    collector.failed(subject, error)
    return null
  }
}
