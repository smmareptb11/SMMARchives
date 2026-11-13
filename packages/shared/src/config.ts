import { parseBoundingBox, type BoundingBox } from './contracts/geometry.ts'
import { ConfigurationError } from './errors.ts'

type Environment = Record<string, string | undefined>

/**
 * Extent shared by every radar rainfall image, live and delivered alike.
 *
 * A reading, not an authority: no world file or specification carries it. A
 * wrong one shifts the whole layer invisibly, hence a parameter, reported with
 * every collection.
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
}

export function aquasysConfig(env: Environment = process.env): AquasysConfig {
  return {
    baseUrl: trimTrailingSlash(requireEnv('ACYCLIQ_API_URL', env)),
    token: requireEnv('ACYCLIQ_TOKEN', env),
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
  /** The extent shared by every raster, reported with the data. */
  extent: BoundingBox
  /** Whether no `RADAR_RAINFALL_BBOX` was given, and the extent is the code's own. */
  extentIsDefault?: boolean | undefined
}

/**
 * The delivered radar rainfall, or nothing when no root is set: the directory
 * exists only once Predict has delivered.
 */
export function radarRainfallConfig(
  env: Environment = process.env,
): RadarRainfallConfig | undefined {
  const root = optionalEnv('RADAR_RAINFALL_PATH', '', env)
  if (root === '') return undefined
  const extent = optionalEnv('RADAR_RAINFALL_BBOX', '', env)
  return { root, extent: parseExtent(extent), extentIsDefault: extent === '' }
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
  /**
   * The addresses whose `X-Forwarded-Proto` is believed, in the form Express
   * reads for `trust proxy`. The loopback when the reverse proxy runs on the
   * host; the private ranges when it runs in a container beside the API.
   */
  trustedProxy: string
}

/**
 * Refuses a port that is not one rather than coercing it: `listen(NaN)` binds an
 * arbitrary free port and reports it as `NaN`.
 */
export function apiConfig(env: Environment = process.env): ApiConfig {
  const value = optionalEnv('API_PORT', '3000', env)
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigurationError('API_PORT', `${value} is not a port number`)
  }
  return { port, trustedProxy: optionalEnv('TRUST_PROXY', 'loopback', env) }
}

export type AuthConfig = {
  /** What `npm run hash-password` prints, never the password itself. */
  passwordHash: string
  /** Keys the digest a session is stored under. */
  sessionSecret: string
}

const MIN_SESSION_SECRET_LENGTH = 32

export function authConfig(env: Environment = process.env): AuthConfig {
  const sessionSecret = requireEnv('SESSION_SECRET', env)
  if (sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new ConfigurationError(
      'SESSION_SECRET',
      `is shorter than ${MIN_SESSION_SECRET_LENGTH} characters`,
    )
  }
  return { passwordHash: requireEnv('ADMIN_PASSWORD_HASH', env), sessionSecret }
}

function parseExtent(value: string): BoundingBox {
  if (value === '') return DEFAULT_RADAR_RAINFALL_EXTENT
  return parseBoundingBox(value, (reason) => new ConfigurationError('RADAR_RAINFALL_BBOX', reason))
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}
