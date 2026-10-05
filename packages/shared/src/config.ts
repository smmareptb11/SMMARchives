import { parseBoundingBox, type BoundingBox } from './contracts/geometry.ts'
import { ConfigurationError } from './errors.ts'

type Environment = Record<string, string | undefined>

/**
 * Extent shared by every radar rainfall image, live and delivered alike.
 *
 * There is no world file, and no specification carries this extent: it is a
 * reading, not an authority. A wrong one shifts the whole rainfall layer, and
 * the shift is invisible on an image of rain — hence a parameter, not a
 * constant, and reported with every collection.
 */
export const DEFAULT_RADAR_RAINFALL_EXTENT: BoundingBox = {
  minLon: -9.9729843329,
  minLat: 39.4674216888,
  maxLon: 14.5551004543,
  maxLat: 54.1888232376,
}

export function requireEnv(name: string, env: Environment = process.env): string {
  const value = env[name]?.trim()
  if (value === undefined || value === '') {
    throw new ConfigurationError(name, 'is required and empty')
  }
  return value
}

export function optionalEnv(
  name: string,
  fallback: string,
  env: Environment = process.env,
): string {
  const value = env[name]?.trim()
  return value === undefined || value === '' ? fallback : value
}

export type AquasysConfig = {
  baseUrl: string
  token: string
  /**
   * Reference under which request bounds are read.
   *
   * Aquasys' storage time zone is not established: two concordant clues point
   * at series stamped on local days. The epoch stays an absolute instant, so
   * stored data is unambiguous; the uncertainty is on bounds and labelling.
   */
  timeZone: string
}

export function aquasysConfig(env: Environment = process.env): AquasysConfig {
  const timeZone = optionalEnv('AQUASYS_TIME_ZONE', 'UTC', env)
  assertTimeZone(timeZone)
  return {
    baseUrl: trimTrailingSlash(requireEnv('ACYCLIQ_API_URL', env)),
    token: requireEnv('ACYCLIQ_TOKEN', env),
    timeZone,
  }
}

export type LizmapConfig = {
  baseUrl: string
}

export function lizmapConfig(env: Environment = process.env): LizmapConfig {
  return { baseUrl: trimTrailingSlash(requireEnv('LIZMAP_BASE_URL', env)) }
}

export type RadarRainfallConfig = {
  root: string
  /**
   * The extent shared by every raster, reported with the data because a wrong
   * one shifts the whole layer without anything on screen saying so.
   */
  extent: BoundingBox
}

/**
 * The delivered radar rainfall, or nothing when no root is set.
 *
 * The delivery directory exists only once Predict has delivered, so a build has
 * to be able to carry on without it.
 */
export function radarRainfallConfig(
  env: Environment = process.env,
): RadarRainfallConfig | undefined {
  const root = optionalEnv('RADAR_RAINFALL_PATH', '', env)
  if (root === '') return undefined
  return { root, extent: parseExtent(optionalEnv('RADAR_RAINFALL_BBOX', '', env)) }
}

export type DatabaseConfig = {
  url: string
}

export function databaseConfig(env: Environment = process.env): DatabaseConfig {
  return { url: requireEnv('DATABASE_URL', env) }
}

export type MediaConfig = {
  /** The volume holding the frozen bytes, one directory per replay. */
  root: string
}

export function mediaConfig(env: Environment = process.env): MediaConfig {
  return { root: requireEnv('MEDIA_PATH', env) }
}

export type ApiConfig = {
  port: number
}

/**
 * Refused rather than coerced: `listen(NaN)` binds an arbitrary free port and
 * reports it as `NaN`, so a typo in the variable becomes an API that is up,
 * unreachable at the port asked for, and says nothing about why.
 */
export function apiConfig(env: Environment = process.env): ApiConfig {
  const value = optionalEnv('API_PORT', '3000', env)
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigurationError('API_PORT', `${value} is not a port number`)
  }
  return { port }
}

function parseExtent(value: string): BoundingBox {
  if (value === '') return DEFAULT_RADAR_RAINFALL_EXTENT
  return parseBoundingBox(value, (reason) => new ConfigurationError('RADAR_RAINFALL_BBOX', reason))
}

function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en', { timeZone })
  } catch {
    throw new ConfigurationError('AQUASYS_TIME_ZONE', `${timeZone} is not an IANA time zone`)
  }
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}
