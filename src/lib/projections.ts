import { Vector2 } from 'three'
import { degToRad, getLocalFrame, mercatorYFromLat } from './math'
import type {
  GeoPoint,
  ProjectionDefinition,
  ProjectionFrame,
  ProjectionParameters,
  ProjectionFamily,
} from './types'
const OUTLINE_SAMPLES = 240
const STEREOGRAPHIC_MIN_DENOMINATOR = 0.03
const GNOMONIC_MIN_FORWARD = 0.16

function createRectangleOutline(halfWidth: number, halfHeight: number) {
  return [
    new Vector2(-halfWidth, -halfHeight),
    new Vector2(halfWidth, -halfHeight),
    new Vector2(halfWidth, halfHeight),
    new Vector2(-halfWidth, halfHeight),
  ]
}

function sampleCircleOutline(radius: number, sampleCount = OUTLINE_SAMPLES) {
  const points: Vector2[] = []

  for (let index = 0; index < sampleCount; index += 1) {
    const angle = (index / sampleCount) * Math.PI * 2

    points.push(new Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius))
  }

  return points
}

function sampleConicOutline(
  rhoInner: number,
  rhoOuter: number,
  rho0: number,
  n: number,
  sampleCount = OUTLINE_SAMPLES,
) {
  const points: Vector2[] = []

  for (let index = 0; index <= sampleCount; index += 1) {
    const lambda = -Math.PI + (index / sampleCount) * Math.PI * 2
    const theta = n * lambda

    points.push(
      new Vector2(
        rhoOuter * Math.sin(theta),
        rho0 - rhoOuter * Math.cos(theta),
      ),
    )
  }

  for (let index = sampleCount; index >= 0; index -= 1) {
    const lambda = -Math.PI + (index / sampleCount) * Math.PI * 2
    const theta = n * lambda

    points.push(
      new Vector2(
        rhoInner * Math.sin(theta),
        rho0 - rhoInner * Math.cos(theta),
      ),
    )
  }

  return points
}

function getMercatorClipY(params: ProjectionParameters) {
  return mercatorYFromLat(degToRad(params.clipLatitudeDeg ?? 85))
}

export function getAlbersGeometry(params: ProjectionParameters) {
  const phi1 = degToRad(params.standardParallel1Deg ?? 20)
  const phi2 = degToRad(params.standardParallel2Deg ?? 50)
  const n = 0.5 * (Math.sin(phi1) + Math.sin(phi2))
  const c = Math.cos(phi1) ** 2 + 2 * n * Math.sin(phi1)
  const rho0 = Math.sqrt(Math.max(0, c)) / n

  return { n, c, rho0 }
}

export function getAlbersRadius(latRad: number, n: number, c: number) {
  return Math.sqrt(Math.max(0, c - 2 * n * Math.sin(latRad))) / n
}

export function getLambertConformalGeometry(params: ProjectionParameters) {
  const phi1 = degToRad(params.standardParallel1Deg ?? 30)
  const phi2 = degToRad(params.standardParallel2Deg ?? 60)
  const clipLatitude = degToRad(params.clipLatitudeDeg ?? 82)
  const n =
    Math.log(Math.cos(phi1) / Math.cos(phi2)) /
    Math.log(
      Math.tan(Math.PI * 0.25 + phi2 * 0.5) /
        Math.tan(Math.PI * 0.25 + phi1 * 0.5),
    )
  const f =
    (Math.cos(phi1) * Math.tan(Math.PI * 0.25 + phi1 * 0.5) ** n) / n
  const rho0 = f

  return { clipLatitude, f, n, rho0 }
}

export function getLambertConformalRadius(latRad: number, n: number, f: number) {
  return f / Math.max(1e-6, Math.tan(Math.PI * 0.25 + latRad * 0.5) ** n)
}

export function getCentralConicGeometry(params: ProjectionParameters) {
  const standardParallel = degToRad(params.standardParallel1Deg ?? 30)
  const clipLatitude = degToRad(params.clipLatitudeDeg ?? 75)
  const n = Math.sin(standardParallel)
  const rho0 = 1 / Math.tan(standardParallel)
  const yOffset = Math.tan(standardParallel)

  return { clipLatitude, n, rho0, standardParallel, yOffset }
}

export function getCentralConicRadius(
  latRad: number,
  standardParallelRad: number,
  rho0: number,
) {
  return rho0 - Math.tan(latRad - standardParallelRad)
}

function getStereographicClipRadius() {
  const forward = STEREOGRAPHIC_MIN_DENOMINATOR - 1
  const east = Math.sqrt(Math.max(0, 1 - forward * forward))

  return east * (2 / STEREOGRAPHIC_MIN_DENOMINATOR)
}

function getGnomonicClipRadius() {
  const east = Math.sqrt(Math.max(0, 1 - GNOMONIC_MIN_FORWARD ** 2))

  return east / GNOMONIC_MIN_FORWARD
}

function cylindricalMercator(
  point: GeoPoint,
  frame: ProjectionFrame,
  params: ProjectionParameters,
) {
  const local = getLocalFrame(point, frame)
  const clipLatitude = degToRad(params.clipLatitudeDeg ?? 85)
  const visible = Math.abs(local.localLat) < clipLatitude

  return {
    x: local.localLon,
    y: visible ? mercatorYFromLat(local.localLat) : 0,
    visible,
    seamCoord: local.localLon,
  }
}

function lambertCylindricalEqualArea(point: GeoPoint, frame: ProjectionFrame) {
  const local = getLocalFrame(point, frame)

  return {
    x: local.localLon,
    y: Math.sin(local.localLat),
    visible: true,
    seamCoord: local.localLon,
  }
}

function centralCylindrical(
  point: GeoPoint,
  frame: ProjectionFrame,
  params: ProjectionParameters,
) {
  const local = getLocalFrame(point, frame)
  const clipLatitude = degToRad(params.clipLatitudeDeg ?? 75)
  const visible = Math.abs(local.localLat) < clipLatitude

  return {
    x: local.localLon,
    y: visible ? Math.tan(local.localLat) : 0,
    visible,
    seamCoord: local.localLon,
  }
}

function albersEqualArea(
  point: GeoPoint,
  frame: ProjectionFrame,
  params: ProjectionParameters,
) {
  const local = getLocalFrame(point, frame)
  const { n, c, rho0 } = getAlbersGeometry(params)
  const rho = getAlbersRadius(local.localLat, n, c)

  return {
    x: rho * Math.sin(n * local.localLon),
    y: rho0 - rho * Math.cos(n * local.localLon),
    visible: true,
    seamCoord: local.localLon,
  }
}

function lambertConformalConic(
  point: GeoPoint,
  frame: ProjectionFrame,
  params: ProjectionParameters,
) {
  const local = getLocalFrame(point, frame)
  const { clipLatitude, f, n, rho0 } = getLambertConformalGeometry(params)
  const visible = Math.abs(local.localLat) < clipLatitude
  const rho =
    visible
      ? getLambertConformalRadius(local.localLat, n, f)
      : 0

  return {
    x: rho * Math.sin(n * local.localLon),
    y: rho0 - rho * Math.cos(n * local.localLon),
    visible,
    seamCoord: local.localLon,
  }
}

function centralConic(
  point: GeoPoint,
  frame: ProjectionFrame,
  params: ProjectionParameters,
) {
  const local = getLocalFrame(point, frame)
  const { clipLatitude, n, rho0, standardParallel, yOffset } =
    getCentralConicGeometry(params)
  const latitudeDelta = local.localLat - standardParallel
  const rho =
    Math.abs(latitudeDelta) < clipLatitude
      ? getCentralConicRadius(local.localLat, standardParallel, rho0)
      : 0
  const visible =
    Math.abs(latitudeDelta) < clipLatitude &&
    Math.cos(latitudeDelta) > 1e-3 &&
    rho > 0

  return {
    x: rho * Math.sin(n * local.localLon),
    y: rho0 - rho * Math.cos(n * local.localLon) + yOffset,
    visible,
    seamCoord: local.localLon,
  }
}

function stereographic(point: GeoPoint, frame: ProjectionFrame) {
  const local = getLocalFrame(point, frame)
  const denominator = 1 + local.forward
  const visible = denominator > STEREOGRAPHIC_MIN_DENOMINATOR
  const scale = visible ? 2 / denominator : 0

  return {
    x: local.east * scale,
    y: local.north * scale,
    visible,
  }
}

function orthographic(point: GeoPoint, frame: ProjectionFrame) {
  const local = getLocalFrame(point, frame)

  return {
    x: local.east,
    y: local.north,
    visible: local.forward >= 0,
  }
}

function gnomonic(point: GeoPoint, frame: ProjectionFrame) {
  const local = getLocalFrame(point, frame)
  const visible = local.forward > GNOMONIC_MIN_FORWARD
  const scale = visible ? 1 / local.forward : 0

  return {
    x: local.east * scale,
    y: local.north * scale,
    visible,
  }
}

const projectionFamilies: ProjectionFamily[] = [
  'Cylindrical',
  'Conic',
  'Azimuthal',
]

export const projectionRegistry: ProjectionDefinition[] = [
  {
    id: 'mercator',
    label: 'Mercator',
    family: 'Cylindrical',
    clipPolicy: 'wrap',
    defaults: { clipLatitudeDeg: 85 },
    visualizationSurface: 'cylinder',
    visualizationMode: 'surface-only',
    forward: cylindricalMercator,
  },
  {
    id: 'lambert-equal-area',
    label: 'Lambert equal-area',
    family: 'Cylindrical',
    clipPolicy: 'wrap',
    defaults: {},
    visualizationSurface: 'cylinder',
    visualizationMode: 'surface-only',
    forward: lambertCylindricalEqualArea,
  },
  {
    id: 'cylindrical-point-geometric',
    label: 'Central',
    family: 'Cylindrical',
    clipPolicy: 'wrap',
    defaults: { clipLatitudeDeg: 75 },
    visualizationSurface: 'cylinder',
    visualizationMode: 'point-source',
    forward: centralCylindrical,
  },
  {
    id: 'albers-equal-area',
    label: 'Albers equal-area',
    family: 'Conic',
    clipPolicy: 'wrap',
    defaults: { standardParallel1Deg: 20, standardParallel2Deg: 50 },
    visualizationSurface: 'cone',
    visualizationMode: 'surface-only',
    forward: albersEqualArea,
  },
  {
    id: 'lambert-conformal',
    label: 'Lambert conformal',
    family: 'Conic',
    clipPolicy: 'wrap',
    defaults: { standardParallel1Deg: 30, standardParallel2Deg: 60, clipLatitudeDeg: 82 },
    visualizationSurface: 'cone',
    visualizationMode: 'surface-only',
    forward: lambertConformalConic,
  },
  {
    id: 'conic-point-geometric',
    label: 'Central',
    family: 'Conic',
    clipPolicy: 'wrap',
    defaults: { standardParallel1Deg: 30, clipLatitudeDeg: 75 },
    visualizationSurface: 'cone',
    visualizationMode: 'point-source',
    forward: centralConic,
  },
  {
    id: 'stereographic',
    label: 'Stereographic',
    family: 'Azimuthal',
    clipPolicy: 'radial',
    defaults: {},
    visualizationSurface: 'plane',
    visualizationMode: 'point-source',
    forward: stereographic,
  },
  {
    id: 'orthographic',
    label: 'Orthographic',
    family: 'Azimuthal',
    clipPolicy: 'radial',
    defaults: {},
    visualizationSurface: 'plane',
    visualizationMode: 'parallel-rays',
    forward: orthographic,
  },
  {
    id: 'gnomonic',
    label: 'Central (Gnomonic)',
    family: 'Azimuthal',
    clipPolicy: 'radial',
    defaults: {},
    visualizationSurface: 'plane',
    visualizationMode: 'point-source',
    forward: gnomonic,
  },
]

export const projectionRegistryById = new Map(
  projectionRegistry.map((definition) => [definition.id, definition]),
)

export const groupedProjectionRegistry = projectionFamilies.map((family) => ({
  family,
  projections: projectionRegistry.filter((projection) => projection.family === family),
}))

export function getProjectionDefinition(projectionId: string) {
  return projectionRegistryById.get(projectionId) ?? projectionRegistry[0]
}

export function supportsProjectionVisualization(projection: ProjectionDefinition) {
  return projection.visualizationMode !== 'unsupported'
}

export function projectGeoPoint(
  projection: ProjectionDefinition,
  point: GeoPoint,
  frame: ProjectionFrame,
) {
  const projected = projection.forward(point, frame, projection.defaults)

  if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
    return { ...projected, visible: false }
  }

  return projected
}

export function getProjectionFrameOutline(projection: ProjectionDefinition) {
  switch (projection.id) {
    case 'mercator':
      return createRectangleOutline(Math.PI, getMercatorClipY(projection.defaults))
    case 'lambert-equal-area':
      return createRectangleOutline(Math.PI, 1)
    case 'cylindrical-point-geometric':
      return createRectangleOutline(
        Math.PI,
        Math.tan(degToRad(projection.defaults.clipLatitudeDeg ?? 75)),
      )
    case 'albers-equal-area': {
      const { c, n, rho0 } = getAlbersGeometry(projection.defaults)
      const northRadius = getAlbersRadius(Math.PI * 0.5, n, c)
      const southRadius = getAlbersRadius(-Math.PI * 0.5, n, c)

      return sampleConicOutline(
        Math.min(northRadius, southRadius),
        Math.max(northRadius, southRadius),
        rho0,
        n,
      )
    }
    case 'lambert-conformal': {
      const { clipLatitude, f, n, rho0 } = getLambertConformalGeometry(
        projection.defaults,
      )
      const northRadius = getLambertConformalRadius(clipLatitude, n, f)
      const southRadius = getLambertConformalRadius(-clipLatitude, n, f)

      return sampleConicOutline(
        Math.min(northRadius, southRadius),
        Math.max(northRadius, southRadius),
        rho0,
        n,
      )
    }
    case 'conic-point-geometric': {
      const { clipLatitude, n, rho0, standardParallel, yOffset } =
        getCentralConicGeometry(projection.defaults)
      const lowerLatitude = Math.max(
        -Math.PI * 0.5 + 1e-3,
        standardParallel - clipLatitude,
      )
      const upperLatitude = Math.min(
        Math.PI * 0.5 - 1e-3,
        standardParallel + clipLatitude,
      )
      const northRadius = getCentralConicRadius(upperLatitude, standardParallel, rho0)
      const southRadius = getCentralConicRadius(lowerLatitude, standardParallel, rho0)

      return sampleConicOutline(
        Math.max(0, Math.min(northRadius, southRadius)),
        Math.max(northRadius, southRadius),
        rho0 + yOffset,
        n,
      )
    }
    case 'stereographic':
      return sampleCircleOutline(getStereographicClipRadius())
    case 'orthographic':
      return sampleCircleOutline(1)
    case 'gnomonic':
      return sampleCircleOutline(getGnomonicClipRadius())
    default:
      return null
  }
}
