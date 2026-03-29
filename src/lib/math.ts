import { Euler, Quaternion, Vector2, Vector3 } from 'three'
import type { GeoPoint, GlobeOrientation, ProjectionFrame } from './types'

export const EPSILON = 1e-6

export function degToRad(value: number) {
  return (value * Math.PI) / 180
}

export function radToDeg(value: number) {
  return (value * 180) / Math.PI
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function wrapLongitudeDeg(value: number) {
  return ((((value + 180) % 360) + 360) % 360) - 180
}

export function normalizeRadians(value: number) {
  return ((((value + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI
}

export function clampLatitudeDeg(value: number, limit = 89.5) {
  return clamp(value, -limit, limit)
}

export function latLonToVector3(point: GeoPoint, radius = 1) {
  const lat = degToRad(point.latDeg)
  const lon = degToRad(point.lonDeg)
  const cosLat = Math.cos(lat)

  return new Vector3(
    radius * cosLat * Math.cos(lon),
    radius * Math.sin(lat),
    -radius * cosLat * Math.sin(lon),
  )
}

export function vector3ToGeoPoint(vector: Vector3): GeoPoint {
  const normalized = vector.clone().normalize()

  return {
    latDeg: radToDeg(Math.asin(clamp(normalized.y, -1, 1))),
    lonDeg: wrapLongitudeDeg(radToDeg(Math.atan2(-normalized.z, normalized.x))),
  }
}

export function mercatorYFromLat(latRad: number) {
  return Math.log(Math.tan(Math.PI * 0.25 + latRad * 0.5))
}

export function getLocalFrame(point: GeoPoint, frame: ProjectionFrame) {
  const lat = degToRad(point.latDeg)
  const lon = degToRad(point.lonDeg)
  const centerLat = degToRad(frame.centerLatDeg)
  const centerLon = degToRad(frame.centralLonDeg)
  const deltaLon = normalizeRadians(lon - centerLon)
  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)
  const sinCenterLat = Math.sin(centerLat)
  const cosCenterLat = Math.cos(centerLat)
  const cosDeltaLon = Math.cos(deltaLon)

  const east = cosLat * Math.sin(deltaLon)
  const north = cosCenterLat * sinLat - sinCenterLat * cosLat * cosDeltaLon
  const forward = sinCenterLat * sinLat + cosCenterLat * cosLat * cosDeltaLon

  return {
    east,
    north,
    forward,
    localLon: Math.atan2(east, forward),
    localLat: Math.asin(clamp(north, -1, 1)),
  }
}

export function createNoRollQuaternion(orientation: GlobeOrientation) {
  return new Quaternion()
    .setFromEuler(
      new Euler(
        -degToRad(orientation.elevationDeg),
        degToRad(orientation.azimuthDeg),
        -degToRad(orientation.rollDeg ?? 0),
        'XYZ',
      ),
    )
    .normalize()
}

export function createDisplayGlobeQuaternion(orientation: GlobeOrientation) {
  return new Quaternion()
    .setFromEuler(
      new Euler(
        -degToRad(orientation.elevationDeg),
        -degToRad(orientation.azimuthDeg),
        degToRad(orientation.rollDeg ?? 0),
        'XYZ',
      ),
    )
    .normalize()
}

export function barycentricWeights(
  point: Vector2,
  a: Vector2,
  b: Vector2,
  c: Vector2,
) {
  const denominator =
    (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y)

  if (Math.abs(denominator) < EPSILON) {
    return null
  }

  const u =
    ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) /
    denominator
  const v =
    ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) /
    denominator
  const w = 1 - u - v

  if (u < -EPSILON || v < -EPSILON || w < -EPSILON) {
    return null
  }

  return { u, v, w }
}

export function interpolateGeoPoint(
  vectors: [Vector3, Vector3, Vector3],
  weights: { u: number; v: number; w: number },
) {
  const blended = new Vector3()
    .addScaledVector(vectors[0], weights.u)
    .addScaledVector(vectors[1], weights.v)
    .addScaledVector(vectors[2], weights.w)
    .normalize()

  return vector3ToGeoPoint(blended)
}
