import {
  frozenWebcamImageSchema,
  radarRainfallSeriesSchema,
  type FrozenWebcamImage,
  type RadarRainfallSeries,
} from '@smmarchives/shared'

import type { Queryable } from '../../../db/tx.ts'
import { insertRows } from './batch.ts'

export async function writeWebcamImages(
  db: Queryable,
  replayId: string,
  data: unknown,
): Promise<void> {
  const images = data as FrozenWebcamImage[]
  // The last of two images on one camera and one instant stands: one statement
  // may not update a row twice.
  const last = new Map(images.map((image) => [`${image.code} ${image.at}`, image]))
  await insertRows(
    db,
    `insert into webcam_image
       (replay_id, code, at, uri, thumb_uri, stored_path, stored_thumb_path)
     select $1, r.code, r.at, r.uri, r.thumb_uri, r.stored_path, r.stored_thumb_path
       from jsonb_to_recordset($2::jsonb) as r(code text, at timestamptz, uri text,
            thumb_uri text, stored_path text, stored_thumb_path text)
     on conflict (replay_id, code, at) do update set
       uri = excluded.uri, thumb_uri = excluded.thumb_uri,
       stored_path = excluded.stored_path,
       stored_thumb_path = excluded.stored_thumb_path`,
    replayId,
    [...last.values()].map((image) => ({
      code: image.code,
      at: image.at,
      uri: image.uri,
      thumb_uri: image.thumbUri,
      stored_path: image.storedPath,
      stored_thumb_path: image.storedThumbPath,
    })),
  )
}

export async function readWebcamImages(
  db: Queryable,
  replayId: string,
  code?: string,
): Promise<FrozenWebcamImage[]> {
  const rows = (
    await db.query<{
      code: string
      at: string
      uri: string
      thumb_uri: string | null
      stored_path: string | null
      stored_thumb_path: string | null
    }>(
      `select code, at, uri, thumb_uri, stored_path, stored_thumb_path from webcam_image
        where replay_id = $1 and ($2::text is null or code = $2)
        order by code, at`,
      [replayId, code ?? null],
    )
  ).rows

  return rows.map((row) =>
    frozenWebcamImageSchema.parse({
      code: row.code,
      at: row.at,
      uri: row.uri,
      thumbUri: row.thumb_uri,
      storedPath: row.stored_path,
      storedThumbPath: row.stored_thumb_path,
    }),
  )
}

/** Frames per statement: a delivery holds thousands, and a round trip each adds up. */
const BATCH = 1_000

/**
 * The radar index: a series per delivery and product, its frames beneath it,
 * each with the address it came from, never one computed from an instant.
 */
export async function writeRadarSeries(
  db: Queryable,
  replayId: string,
  data: unknown,
): Promise<void> {
  const series = data as RadarRainfallSeries[]
  for (const one of series) {
    await db.query(
      `insert into radar_series (replay_id, delivery, product, median_step_minutes)
       values ($1, $2, $3, $4)`,
      [replayId, one.delivery, one.product, one.medianStepMinutes],
    )
    for (let start = 0; start < one.frames.length; start += BATCH) {
      const batch = one.frames.slice(start, start + BATCH)
      await db.query(
        `insert into radar_frame (replay_id, delivery, product, at, path)
         select $1, $2, $3, u.at, u.path
           from unnest($4::timestamptz[], $5::text[]) as u(at, path)`,
        [
          replayId,
          one.delivery,
          one.product,
          batch.map((frame) => frame.at),
          batch.map((frame) => frame.path),
        ],
      )
    }
  }
}

export async function readRadarSeries(
  db: Queryable,
  replayId: string,
): Promise<RadarRainfallSeries[]> {
  const series = (
    await db.query<{ delivery: string; product: string; median_step_minutes: number | null }>(
      `select delivery, product, median_step_minutes from radar_series
        where replay_id = $1 order by delivery, product`,
      [replayId],
    )
  ).rows

  const frames = (
    await db.query<{ delivery: string; product: string; at: string; path: string }>(
      `select delivery, product, at, path from radar_frame
        where replay_id = $1 order by delivery, product, at`,
      [replayId],
    )
  ).rows

  return series.map((one) =>
    radarRainfallSeriesSchema.parse({
      delivery: one.delivery,
      product: one.product,
      medianStepMinutes: one.median_step_minutes,
      frames: frames
        .filter((frame) => frame.delivery === one.delivery && frame.product === one.product)
        .map((frame) => ({ at: frame.at, path: frame.path })),
    }),
  )
}
