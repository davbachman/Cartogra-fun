import { clamp, degToRad, wrapLongitudeDeg } from './math'
import type { GeoPoint } from './types'

const MINUTES_PER_DAY = 24 * 60
const FULL_NIGHT_ALTITUDE_DEG = -3.5
const FULL_DAY_ALTITUDE_DEG = 1.5

export const DAYLIGHT_BLEND_MIN_SINE = Math.sin(
  degToRad(FULL_NIGHT_ALTITUDE_DEG),
)
export const DAYLIGHT_BLEND_MAX_SINE = Math.sin(
  degToRad(FULL_DAY_ALTITUDE_DEG),
)

export type SolarCoordinates = {
  declinationRad: number
  subsolarLatDeg: number
  subsolarLonDeg: number
  subsolarLonRad: number
}

function smoothstep(min: number, max: number, value: number) {
  const normalized = clamp((value - min) / (max - min), 0, 1)

  return normalized * normalized * (3 - 2 * normalized)
}

function getUtcDayOfYear(date: Date) {
  const utcMidnight = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  )
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 0)

  return Math.floor((utcMidnight - yearStart) / 86_400_000)
}

export function getSolarCoordinates(timestampMs: number): SolarCoordinates {
  const date = new Date(timestampMs)
  const dayOfYear = getUtcDayOfYear(date)
  const utcMinutes =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    date.getUTCMilliseconds() / 60_000
  const fractionalYear =
    ((Math.PI * 2) / 365) * (dayOfYear - 1 + (utcMinutes - 720) / MINUTES_PER_DAY)
  const equationOfTimeMinutes =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(fractionalYear) -
      0.032077 * Math.sin(fractionalYear) -
      0.014615 * Math.cos(fractionalYear * 2) -
      0.040849 * Math.sin(fractionalYear * 2))
  const declinationRad =
    0.006918 -
    0.399912 * Math.cos(fractionalYear) +
    0.070257 * Math.sin(fractionalYear) -
    0.006758 * Math.cos(fractionalYear * 2) +
    0.000907 * Math.sin(fractionalYear * 2) -
    0.002697 * Math.cos(fractionalYear * 3) +
    0.00148 * Math.sin(fractionalYear * 3)
  const subsolarLonDeg = wrapLongitudeDeg(
    (720 - utcMinutes - equationOfTimeMinutes) / 4,
  )

  return {
    declinationRad,
    subsolarLatDeg: (declinationRad * 180) / Math.PI,
    subsolarLonDeg,
    subsolarLonRad: degToRad(subsolarLonDeg),
  }
}

export function getDaylightBlendFactor(
  point: GeoPoint,
  solarCoordinates: SolarCoordinates,
) {
  const latitudeRad = degToRad(point.latDeg)
  const longitudeRad = degToRad(point.lonDeg)
  const cosineSolarZenith =
    Math.sin(latitudeRad) * Math.sin(solarCoordinates.declinationRad) +
    Math.cos(latitudeRad) *
      Math.cos(solarCoordinates.declinationRad) *
      Math.cos(longitudeRad - solarCoordinates.subsolarLonRad)

  return getDaylightBlendFactorFromCosineSolarZenith(cosineSolarZenith)
}

export function getDaylightBlendFactorFromCosineSolarZenith(
  cosineSolarZenith: number,
) {
  return smoothstep(
    DAYLIGHT_BLEND_MIN_SINE,
    DAYLIGHT_BLEND_MAX_SINE,
    cosineSolarZenith,
  )
}
