import type { ReplayManifest, Severity } from '@smmarchives/shared/contracts/replay.ts'

import { phenomenonLabel, severityLabel } from '../about.ts'
import { replayPath } from '../routing.ts'
import { formatDuration, formatInstant, formatPeriod } from '../time.ts'

const STATE_LABEL: Record<ReplayManifest['state'], string> = {
  running: 'En cours',
  complete: 'Complet',
  partial: 'Partiel',
  failed: 'Échoué',
}

export type ReplayEntry = {
  id: string
  href: string
  title: string
  period: string
  duration: string
  extent: string
  /** What the administrator said of it, each absent when nothing was said. */
  description: string | undefined
  phenomenon: string | undefined
  severity: { level: Severity; label: string } | undefined
  /** What the replay holds, each figure absent while the manifest has none to give. */
  figures: string[]
  createdAt: string
  /** Whether everyone sees it, or only the administrator. */
  public: boolean
  state: ReplayManifest['state']
  stateLabel: string
}

/**
 * One line of the list, read from the manifest alone: opening every replay's
 * data sets to name it would cost a build's worth of reads per visit.
 */
export function entryOf(manifest: ReplayManifest): ReplayEntry {
  return {
    id: manifest.id,
    href: replayPath(manifest.id),
    // The API accepts a blank label where the form does not, and a blank title
    // would leave the line with a link nobody can click.
    title: manifest.label?.trim() || 'Rejeu sans titre',
    period: formatPeriod(manifest.period),
    duration: formatDuration(manifest.period),
    extent: extentOf(manifest),
    description: manifest.description,
    phenomenon:
      manifest.phenomenon === undefined ? undefined : phenomenonLabel(manifest.phenomenon),
    severity:
      manifest.severity === undefined
        ? undefined
        : { level: manifest.severity, label: severityLabel(manifest.severity) },
    figures: figuresOf(manifest),
    createdAt: formatInstant(manifest.createdAt),
    public: manifest.publishedAt !== undefined,
    state: manifest.state,
    stateLabel: STATE_LABEL[manifest.state],
  }
}

/** The territory a replay covers, by the union it was framed on when one names it. */
function extentOf(manifest: ReplayManifest): string {
  if (manifest.extent === null) return 'Tout le territoire'
  return manifest.territory ?? 'Emprise réduite'
}

const COUNT = new Intl.NumberFormat('fr-FR')

function counted(count: number, one: string, many: string): string {
  return `${COUNT.format(count)} ${count <= 1 ? one : many}`
}

/**
 * The few counts a card shows, as the manifest states them: only what the replay
 * holds some of, and none while it is still being built.
 */
function figuresOf(manifest: ReplayManifest): string[] {
  if (manifest.state === 'running') return []
  const figures: string[] = []
  if (manifest.fleet !== undefined) {
    const { hydro, 'rain-gauge': gauges } = manifest.fleet
    pushFleet(figures, hydro, 'station mesurée', 'stations mesurées')
    pushFleet(figures, gauges, 'pluviomètre mesuré', 'pluviomètres mesurés')
  }
  pushCount(figures, manifest.events?.crossings, 'franchissement', 'franchissements')
  // Named apart: the files copied mix rasters and photos, and a reader told
  // « images » pictures photos.
  pushCount(figures, manifest.radarFrames, 'image radar', 'images radar')
  const photos = manifest.datasets['webcam-images']?.count
  pushCount(figures, photos, 'photo de webcam', 'photos de webcam')
  return figures
}

function pushCount(figures: string[], count: number | undefined, one: string, many: string): void {
  if (count !== undefined && count > 0) figures.push(counted(count, one, many))
}

/**
 * How much of one family measured, each family on its own: counted together, rain
 * gauges would be read as stations.
 */
function pushFleet(
  figures: string[],
  family: { inExtent: number; withMeasures: number },
  one: string,
  many: string,
): void {
  if (family.withMeasures === 0) return
  figures.push(`${counted(family.withMeasures, one, many)} sur ${COUNT.format(family.inExtent)}`)
}

/**
 * The lines of the list, in the order the API gave them: it already orders on
 * `createdAt`, and a second rule here could only drift from the first.
 */
export function entriesOf(manifests: readonly ReplayManifest[]): ReplayEntry[] {
  return manifests.map(entryOf)
}

export type Gallery = {
  published: ReplayEntry[]
  /** Built, being built or failed, and not public: the administrator's alone. */
  preparing: ReplayEntry[]
}

/** The two sections of the list, each in the order the API gave. */
export function galleryOf(manifests: readonly ReplayManifest[]): Gallery {
  const entries = entriesOf(manifests)
  return {
    published: entries.filter((entry) => entry.public),
    preparing: entries.filter((entry) => !entry.public),
  }
}

/** The gallery once a replay is gone from it, whichever section held it. */
export function withoutReplay(gallery: Gallery, id: string): Gallery {
  return {
    published: gallery.published.filter((entry) => entry.id !== id),
    preparing: gallery.preparing.filter((entry) => entry.id !== id),
  }
}
