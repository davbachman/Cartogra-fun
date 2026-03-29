import { Vector2, Vector3 } from 'three'
import {
  clamp,
  createNoRollQuaternion,
  degToRad,
  EPSILON,
  latLonToVector3,
  radToDeg,
  vector3ToGeoPoint,
} from './math'
import { projectGeoPoint } from './projections'
import type {
  GeoPoint,
  GlobeOrientation,
  ProjectionDefinition,
  ProjectionFrame,
  SelectionSource,
} from './types'

const DERIVATIVE_STEPS_RAD = [0.003, 0.0015, 0.00075, 0.000375]
const MAX_INVERSE_TANGENT_RADIUS_RAD = 0.38

export const INDICATRIX_RADIUS = 0.125
export const INDICATRIX_SEGMENTS = 56

export interface DistortionMetrics {
  areaFactor: number
  majorScale: number
  minorScale: number
  anisotropy: number
  eccentricity: number
  angularDistortionDeg: number
}

export interface IndicatrixAnalysis {
  centerRaw: Vector2
  jacobian: [[number, number], [number, number]]
  inverseJacobian: [[number, number], [number, number]] | null
  metrics: DistortionMetrics
}

function getSphereBasis(point: GeoPoint) {
  const lat = degToRad(point.latDeg)
  const lon = degToRad(point.lonDeg)

  const center = latLonToVector3(point)
  const east = new Vector3(-Math.sin(lon), 0, -Math.cos(lon)).normalize()
  const north = new Vector3(
    -Math.sin(lat) * Math.cos(lon),
    Math.cos(lat),
    Math.sin(lat) * Math.sin(lon),
  ).normalize()

  return { center, east, north }
}

function offsetPointOnSphere(
  point: GeoPoint,
  east: Vector3,
  north: Vector3,
  deltaEast: number,
  deltaNorth: number,
) {
  const radius = Math.hypot(deltaEast, deltaNorth)

  if (radius < EPSILON) {
    return point
  }

  const direction = east
    .clone()
    .multiplyScalar(deltaEast)
    .addScaledVector(north, deltaNorth)
    .normalize()
  const center = latLonToVector3(point)
  const offset = center
    .clone()
    .multiplyScalar(Math.cos(radius))
    .addScaledVector(direction, Math.sin(radius))

  return vector3ToGeoPoint(offset)
}

function createProjectedPointGetter(
  projection: ProjectionDefinition,
  frame: ProjectionFrame,
  globeOrientation: GlobeOrientation,
) {
  const globeQuaternion = createNoRollQuaternion(globeOrientation)

  return (point: GeoPoint) => {
    const rotatedPoint = vector3ToGeoPoint(
      latLonToVector3(point).applyQuaternion(globeQuaternion),
    )
    const projected = projectGeoPoint(projection, rotatedPoint, frame)

    if (!projected.visible) {
      return null
    }

    return new Vector2(projected.x, projected.y)
  }
}

function invert2x2(
  matrix: [[number, number], [number, number]],
): [[number, number], [number, number]] | null {
  const [[a, b], [c, d]] = matrix
  const determinant = a * d - b * c

  if (Math.abs(determinant) < 1e-8) {
    return null
  }

  return [
    [d / determinant, -b / determinant],
    [-c / determinant, a / determinant],
  ]
}

function multiply2x2(
  matrix: [[number, number], [number, number]],
  x: number,
  y: number,
) {
  return new Vector2(
    matrix[0][0] * x + matrix[0][1] * y,
    matrix[1][0] * x + matrix[1][1] * y,
  )
}

function deriveMetrics(
  matrix: [[number, number], [number, number]],
): DistortionMetrics {
  const [[a, b], [c, d]] = matrix
  const symmetricA = a * a + c * c
  const symmetricB = a * b + c * d
  const symmetricD = b * b + d * d
  const trace = symmetricA + symmetricD
  const delta = Math.sqrt(
    Math.max(
      0,
      (symmetricA - symmetricD) * (symmetricA - symmetricD) +
        4 * symmetricB * symmetricB,
    ),
  )
  const majorScale = Math.sqrt(Math.max(0, (trace + delta) * 0.5))
  const minorScale = Math.sqrt(Math.max(0, (trace - delta) * 0.5))
  const sum = majorScale + minorScale
  const areaFactor = Math.abs(a * d - b * c)
  const angularDistortionRatio =
    sum > EPSILON ? clamp((majorScale - minorScale) / sum, 0, 1) : 0

  return {
    areaFactor,
    majorScale,
    minorScale,
    anisotropy: minorScale > EPSILON ? majorScale / minorScale : Number.POSITIVE_INFINITY,
    eccentricity:
      majorScale > EPSILON
        ? Math.sqrt(
            clamp(1 - (minorScale * minorScale) / (majorScale * majorScale), 0, 1),
          )
        : 0,
    angularDistortionDeg: radToDeg(2 * Math.asin(angularDistortionRatio)),
  }
}

export function analyzeIndicatrixAtPoint(
  projection: ProjectionDefinition,
  frame: ProjectionFrame,
  globeOrientation: GlobeOrientation,
  point: GeoPoint,
) {
  const project = createProjectedPointGetter(projection, frame, globeOrientation)
  const centerRaw = project(point)

  if (!centerRaw) {
    return null
  }

  const { east, north } = getSphereBasis(point)

  for (const step of DERIVATIVE_STEPS_RAD) {
    const eastPlus = project(offsetPointOnSphere(point, east, north, step, 0))
    const eastMinus = project(offsetPointOnSphere(point, east, north, -step, 0))
    const northPlus = project(offsetPointOnSphere(point, east, north, 0, step))
    const northMinus = project(offsetPointOnSphere(point, east, north, 0, -step))

    if (!eastPlus || !eastMinus || !northPlus || !northMinus) {
      continue
    }

    const jacobian: [[number, number], [number, number]] = [
      [
        (eastPlus.x - eastMinus.x) / (2 * step),
        (northPlus.x - northMinus.x) / (2 * step),
      ],
      [
        (eastPlus.y - eastMinus.y) / (2 * step),
        (northPlus.y - northMinus.y) / (2 * step),
      ],
    ]

    return {
      centerRaw,
      jacobian,
      inverseJacobian: invert2x2(jacobian),
      metrics: deriveMetrics(jacobian),
    } satisfies IndicatrixAnalysis
  }

  return null
}

export function sampleMapIndicatrixBoundary(
  analysis: IndicatrixAnalysis,
  source: SelectionSource,
  radius = INDICATRIX_RADIUS,
  segments = INDICATRIX_SEGMENTS,
) {
  const points: Vector2[] = []

  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2
    const unitX = Math.cos(angle)
    const unitY = Math.sin(angle)
    const rawOffset =
      source === 'map'
        ? new Vector2(unitX * radius, unitY * radius)
        : multiply2x2(analysis.jacobian, unitX * radius, unitY * radius)

    points.push(analysis.centerRaw.clone().add(rawOffset))
  }

  return points
}

export function sampleGeodesicCircleBoundary(
  point: GeoPoint,
  radius = INDICATRIX_RADIUS,
  segments = INDICATRIX_SEGMENTS,
) {
  const { east, north } = getSphereBasis(point)
  const points: GeoPoint[] = []

  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2

    points.push(
      offsetPointOnSphere(
        point,
        east,
        north,
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
      ),
    )
  }

  return points
}

export function sampleGlobeIndicatrixBoundary(
  point: GeoPoint,
  analysis: IndicatrixAnalysis | null,
  source: SelectionSource,
  radius = INDICATRIX_RADIUS,
  segments = INDICATRIX_SEGMENTS,
) {
  const { east, north } = getSphereBasis(point)
  const points: GeoPoint[] = []

  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2
    const unitX = Math.cos(angle)
    const unitY = Math.sin(angle)
    const tangentOffset =
      source === 'globe'
        ? new Vector2(unitX * radius, unitY * radius)
        : analysis?.inverseJacobian
          ? multiply2x2(analysis.inverseJacobian, unitX * radius, unitY * radius)
          : null

    if (!tangentOffset) {
      return null
    }

    if (tangentOffset.length() > MAX_INVERSE_TANGENT_RADIUS_RAD) {
      return null
    }

    points.push(
      offsetPointOnSphere(point, east, north, tangentOffset.x, tangentOffset.y),
    )
  }

  return points
}
