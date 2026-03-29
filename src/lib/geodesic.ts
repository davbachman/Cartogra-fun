import { Vector2, Vector3 } from 'three'
import { EPSILON, clamp, latLonToVector3, vector3ToGeoPoint } from './math'
import { pickGeoPointFromScene, type MapScene } from './mapScene'
import type { GeoPoint } from './types'

export const GEODESIC_SAMPLE_SEGMENTS = 96

function getFallbackNormal(vector: Vector3) {
  const referenceAxis = Math.abs(vector.y) < 0.9
    ? new Vector3(0, 1, 0)
    : new Vector3(1, 0, 0)

  return new Vector3().crossVectors(vector, referenceAxis).normalize()
}

export function sampleGeodesicArc(
  start: GeoPoint,
  end: GeoPoint,
  segments = GEODESIC_SAMPLE_SEGMENTS,
) {
  const startVector = latLonToVector3(start).normalize()
  const endVector = latLonToVector3(end).normalize()
  const dot = clamp(startVector.dot(endVector), -1, 1)
  const angle = Math.acos(dot)

  if (angle < EPSILON) {
    return [start, end]
  }

  const normal = new Vector3().crossVectors(startVector, endVector)

  if (normal.lengthSq() < 1e-12) {
    normal.copy(getFallbackNormal(startVector))
  } else {
    normal.normalize()
  }

  const points: GeoPoint[] = []

  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments
    const point = startVector.clone().applyAxisAngle(normal, angle * t).normalize()

    points.push(vector3ToGeoPoint(point))
  }

  return points
}

export function sampleScreenLine(
  start: Vector2,
  end: Vector2,
  segments = GEODESIC_SAMPLE_SEGMENTS,
) {
  const points: Vector2[] = []

  for (let index = 0; index <= segments; index += 1) {
    points.push(new Vector2().lerpVectors(start, end, index / segments))
  }

  return points
}

export function splitProjectedGeoPath(
  scene: MapScene,
  points: GeoPoint[],
  maxJump: number,
) {
  const segments: Vector2[][] = []
  let currentSegment: Vector2[] = []
  let previousPoint: Vector2 | null = null

  for (const point of points) {
    const projectedPoint = scene.projectGeoToScreen(point)

    if (!projectedPoint) {
      if (currentSegment.length > 1) {
        segments.push(currentSegment)
      }

      currentSegment = []
      previousPoint = null
      continue
    }

    if (
      previousPoint &&
      projectedPoint.distanceTo(previousPoint) > maxJump
    ) {
      if (currentSegment.length > 1) {
        segments.push(currentSegment)
      }

      currentSegment = []
    }

    currentSegment.push(projectedPoint)
    previousPoint = projectedPoint
  }

  if (currentSegment.length > 1) {
    segments.push(currentSegment)
  }

  return segments
}

export function sampleMapLinePreimage(
  scene: MapScene,
  start: GeoPoint,
  end: GeoPoint,
  segments = GEODESIC_SAMPLE_SEGMENTS,
) {
  const startScreenPoint = scene.projectGeoToScreen(start)
  const endScreenPoint = scene.projectGeoToScreen(end)

  if (!startScreenPoint || !endScreenPoint) {
    return []
  }

  const geoSegments: GeoPoint[][] = []
  let currentSegment: GeoPoint[] = []

  for (const point of sampleScreenLine(startScreenPoint, endScreenPoint, segments)) {
    const geoPoint = pickGeoPointFromScene(scene, point.x, point.y)

    if (!geoPoint) {
      if (currentSegment.length > 1) {
        geoSegments.push(currentSegment)
      }

      currentSegment = []
      continue
    }

    currentSegment.push(geoPoint)
  }

  if (currentSegment.length > 1) {
    geoSegments.push(currentSegment)
  }

  return geoSegments
}
