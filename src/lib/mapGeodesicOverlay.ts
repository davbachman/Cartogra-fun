import { Vector2 } from 'three'
import { sampleGeodesicArc, splitProjectedGeoPath } from './geodesic'
import type { MapScene } from './mapScene'
import type { GeodesicSelection, Size } from './types'

const PROJECTED_CURVE_MAX_JUMP_FACTOR = 0.32

export type MapGeodesicOverlay = {
  endpoints: Vector2[]
  segments: Vector2[][]
}

export function buildMapGeodesicOverlay(
  scene: MapScene,
  size: Size,
  geodesicSelection: GeodesicSelection | null,
) {
  if (!geodesicSelection || geodesicSelection.points.length === 0) {
    return null
  }

  const endpoints = geodesicSelection.points
    .map((point) => scene.projectGeoToScreen(point))
    .filter((point): point is Vector2 => point !== null)

  if (geodesicSelection.points.length < 2) {
    return endpoints.length > 0
      ? {
          endpoints,
          segments: [],
        }
      : null
  }

  const maxJump = Math.max(size.width, size.height) * PROJECTED_CURVE_MAX_JUMP_FACTOR
  const projectedSegments = splitProjectedGeoPath(
    scene,
    sampleGeodesicArc(
      geodesicSelection.points[0],
      geodesicSelection.points[1],
    ),
    maxJump,
  )

  return endpoints.length > 0 || projectedSegments.length > 0
    ? {
        endpoints,
        segments: projectedSegments,
      }
    : null
}
