import {
  phenomenonSchema,
  severitySchema,
  type Phenomenon,
  type Severity,
} from '@smmarchives/shared/contracts/replay.ts'

const PHENOMENON_LABEL: Record<Phenomenon, string> = {
  flood: 'Crue',
  'intense-rainfall': 'Orage / pluie intense',
  runoff: 'Ruissellement',
  'marine-submersion': 'Submersion marine',
  windstorm: 'Tempête',
  other: 'Autre',
}

const SEVERITY_LABEL: Record<Severity, string> = {
  vigilance: 'Vigilance',
  alert: 'Alerte',
  'reinforced-alert': 'Alerte renforcée',
  crisis: 'Crise',
}

export type Choice<T> = { value: T; label: string }

/** The phenomena a replay is classed by, in the contract's order. */
export const PHENOMENA: readonly Choice<Phenomenon>[] = phenomenonSchema.options.map((value) => ({
  value,
  label: PHENOMENON_LABEL[value],
}))

/** The SMMAR's ladder, lowest first, as the contract orders it. */
export const SEVERITIES: readonly Choice<Severity>[] = severitySchema.options.map((value) => ({
  value,
  label: SEVERITY_LABEL[value],
}))

export function phenomenonLabel(value: Phenomenon): string {
  return PHENOMENON_LABEL[value]
}

export function severityLabel(value: Severity): string {
  return SEVERITY_LABEL[value]
}
