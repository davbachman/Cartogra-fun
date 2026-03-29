import { Matrix4, Quaternion, Vector3 } from 'three'
import { GLOBE_RADIUS } from './globeConstants'
import {
  createDisplayGlobeQuaternion,
  degToRad,
  latLonToVector3,
  vector3ToGeoPoint,
} from './math'
import { baseMapMesh } from './mesh'
import {
  getAlbersGeometry,
  getAlbersRadius,
  getCentralConicGeometry,
  getCentralConicRadius,
  getProjectionFrameOutline,
  getLambertConformalGeometry,
  getLambertConformalRadius,
  projectGeoPoint,
} from './projections'
import type {
  ForwardProjectionResult,
  GeoPoint,
  GlobeOrientation,
  ProjectionDefinition,
  ProjectionFrame,
} from './types'

type SurfaceLocalPoint = {
  forward: number
  north: number
  east: number
}

type FrameBasis = {
  forward: Vector3
  north: Vector3
  east: Vector3
}

type LocalBounds = {
  minForward: number
  maxForward: number
  minNorth: number
  maxNorth: number
  minEast: number
  maxEast: number
}

type ConeEmbedding = {
  alpha: number
  apexNorth: number
  n: number
  rho0: number
  scale: number
}

type StoredSurfaceSegment = {
  start: SurfaceLocalPoint
  end: SurfaceLocalPoint
}

type CurveOverlayInput = {
  endpoints: GeoPoint[]
  segments: GeoPoint[][]
}

export type ProjectionShell =
  | {
      type: 'plane'
      corners: [
        [number, number, number],
        [number, number, number],
        [number, number, number],
        [number, number, number],
      ]
    }
  | {
      type: 'cylinder'
      center: [number, number, number]
      quaternion: [number, number, number, number]
      radius: number
      height: number
    }
  | {
      type: 'cone'
      center: [number, number, number]
      quaternion: [number, number, number, number]
      topRadius: number
      bottomRadius: number
      height: number
    }

export interface ProjectionVisualizationModel {
  graticulePositions: Float32Array
  curveSurfacePositions: Float32Array
  curveSurfaceEndpoints: [number, number, number][]
  shell: ProjectionShell | null
  translucentGlobe: boolean
  sourcePoint: [number, number, number] | null
  sourceLine:
    | {
        start: [number, number, number]
        end: [number, number, number]
      }
    | null
  selectionSurfacePoint: [number, number, number] | null
  selectionRay:
    | {
        start: [number, number, number]
        end: [number, number, number]
      }
    | null
}

const EPSILON = 1e-6
const SHELL_PADDING = 0.12
const SHELL_INSET = 0.01
const PLANE_SURFACE_OFFSET = GLOBE_RADIUS + SHELL_INSET
const GLOBE_PICK_RADIUS = GLOBE_RADIUS * 1.002
const CONE_EMBEDDING_CACHE = new Map<string, ConeEmbedding | null>()
const BASE_GRATICULE_LINE_VECTORS = baseMapMesh.graticuleLines.map((line) =>
  line.map((point) => latLonToVector3(point)),
)

function tuple3(vector: Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z]
}

function tuple4(quaternion: Quaternion): [number, number, number, number] {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w]
}

function makeQuaternion(
  xAxis: Vector3,
  yAxis: Vector3,
  zAxis: Vector3,
) {
  const matrix = new Matrix4().makeBasis(xAxis, yAxis, zAxis)

  return new Quaternion().setFromRotationMatrix(matrix)
}

function createLocalBounds(): LocalBounds {
  return {
    minForward: Infinity,
    maxForward: -Infinity,
    minNorth: Infinity,
    maxNorth: -Infinity,
    minEast: Infinity,
    maxEast: -Infinity,
  }
}

function expandLocalBounds(bounds: LocalBounds, point: SurfaceLocalPoint) {
  bounds.minForward = Math.min(bounds.minForward, point.forward)
  bounds.maxForward = Math.max(bounds.maxForward, point.forward)
  bounds.minNorth = Math.min(bounds.minNorth, point.north)
  bounds.maxNorth = Math.max(bounds.maxNorth, point.north)
  bounds.minEast = Math.min(bounds.minEast, point.east)
  bounds.maxEast = Math.max(bounds.maxEast, point.east)
}

function getFrameBasis(frame: ProjectionFrame): FrameBasis {
  const centerLat = degToRad(frame.centerLatDeg)
  const centerLon = degToRad(frame.centralLonDeg)
  const cosLat = Math.cos(centerLat)
  const sinLat = Math.sin(centerLat)
  const cosLon = Math.cos(centerLon)
  const sinLon = Math.sin(centerLon)
  const forward = new Vector3(cosLat * cosLon, sinLat, -cosLat * sinLon).normalize()
  const east = new Vector3(-sinLon, 0, -cosLon).normalize()
  const north = new Vector3(
    -sinLat * cosLon,
    cosLat,
    sinLat * sinLon,
  ).normalize()

  return { forward, north, east }
}

function localToWorld(basis: FrameBasis, point: SurfaceLocalPoint) {
  return new Vector3()
    .addScaledVector(basis.forward, point.forward)
    .addScaledVector(basis.north, point.north)
    .addScaledVector(basis.east, point.east)
}

function getConeEmbedding(projection: ProjectionDefinition) {
  const cachedEmbedding = CONE_EMBEDDING_CACHE.get(projection.id)

  if (cachedEmbedding !== undefined) {
    return cachedEmbedding
  }

  let embedding: ConeEmbedding | null

  switch (projection.id) {
    case 'albers-equal-area': {
      const params = projection.defaults
      const { c, n, rho0 } = getAlbersGeometry(params)
      const referenceLatRad = degToRad(
        ((params.standardParallel1Deg ?? 20) + (params.standardParallel2Deg ?? 50)) *
          0.5,
      )
      const referenceRho = getAlbersRadius(referenceLatRad, n, c)

      embedding = createConeEmbedding(referenceLatRad, referenceRho, rho0, n)
      break
    }
    case 'lambert-conformal': {
      const params = projection.defaults
      const { f, n, rho0 } = getLambertConformalGeometry(params)
      const referenceLatRad = degToRad(
        ((params.standardParallel1Deg ?? 30) + (params.standardParallel2Deg ?? 60)) *
          0.5,
      )
      const referenceRho = getLambertConformalRadius(referenceLatRad, n, f)

      embedding = createConeEmbedding(referenceLatRad, referenceRho, rho0, n)
      break
    }
    case 'conic-point-geometric': {
      const params = projection.defaults
      const { n, rho0, standardParallel, yOffset } = getCentralConicGeometry(params)
      const referenceRho = getCentralConicRadius(standardParallel, standardParallel, rho0)

      embedding = createConeEmbedding(
        standardParallel,
        referenceRho,
        rho0 + yOffset,
        n,
      )
      break
    }
    default:
      embedding = null
      break
  }

  CONE_EMBEDDING_CACHE.set(projection.id, embedding)

  return embedding
}

function createConeEmbedding(
  referenceLatRad: number,
  referenceRho: number,
  rho0: number,
  n: number,
): ConeEmbedding | null {
  if (Math.abs(n) < 0.02 || Math.abs(referenceRho) < EPSILON) {
    return null
  }

  const alpha = Math.asin(Math.min(0.98, Math.max(0.08, Math.abs(n))))
  const referenceRadius = GLOBE_RADIUS * Math.cos(referenceLatRad)
  const referenceNorth = GLOBE_RADIUS * Math.sin(referenceLatRad)
  const apexNorth = referenceNorth + referenceRadius / Math.tan(alpha)
  const slantAtReference = referenceRadius / Math.sin(alpha)
  const scale = slantAtReference / referenceRho

  return {
    alpha,
    apexNorth,
    n,
    rho0,
    scale,
  }
}

type SurfaceProjector = {
  coneEmbedding: ConeEmbedding | null
  project: (raw: Pick<ForwardProjectionResult, 'x' | 'y'>) => SurfaceLocalPoint | null
}

function createSurfaceProjector(
  projection: ProjectionDefinition,
): SurfaceProjector {
  if (projection.visualizationSurface === 'plane') {
    return {
      coneEmbedding: null,
      project(raw) {
        return {
          forward: PLANE_SURFACE_OFFSET,
          north: raw.y * GLOBE_RADIUS,
          east: raw.x * GLOBE_RADIUS,
        }
      },
    }
  }

  if (projection.visualizationSurface === 'cylinder') {
    return {
      coneEmbedding: null,
      project(raw) {
        return {
          forward: Math.cos(raw.x) * GLOBE_RADIUS,
          north: raw.y * GLOBE_RADIUS,
          east: Math.sin(raw.x) * GLOBE_RADIUS,
        }
      },
    }
  }

  if (projection.visualizationSurface === 'cone') {
    const coneEmbedding = getConeEmbedding(projection)

    return {
      coneEmbedding,
      project(raw) {
        if (!coneEmbedding) {
          return null
        }

        const rhoVectorY = coneEmbedding.rho0 - raw.y
        const rho = Math.hypot(raw.x, rhoVectorY)
        const theta = Math.atan2(raw.x, rhoVectorY)
        const sweep = theta / coneEmbedding.n
        const slant = rho * coneEmbedding.scale
        const radial = slant * Math.sin(coneEmbedding.alpha)
        const north = coneEmbedding.apexNorth - slant * Math.cos(coneEmbedding.alpha)

        return {
          forward: radial * Math.cos(sweep),
          north,
          east: radial * Math.sin(sweep),
        }
      },
    }
  }

  return {
    coneEmbedding: null,
    project() {
      return null
    },
  }
}

function orientSurfacePointForDisplay(
  projection: ProjectionDefinition,
  point: SurfaceLocalPoint,
  bounds: LocalBounds,
) {
  void projection
  void bounds

  return point
}

function buildSourcePoint(
  _basis: FrameBasis,
  projection: ProjectionDefinition,
) {
  switch (projection.id) {
    case 'gnomonic':
    case 'conic-point-geometric':
      return new Vector3(0, 0, 0)
    default:
      return null
  }
}

function buildSourceLine(
  basis: FrameBasis,
  minNorth: number,
  maxNorth: number,
) {
  const safeMinNorth = Number.isFinite(minNorth) ? minNorth : -GLOBE_RADIUS * 1.15
  const safeMaxNorth = Number.isFinite(maxNorth) ? maxNorth : GLOBE_RADIUS * 1.15
  const start = localToWorld(basis, {
    forward: 0,
    north: Math.min(safeMinNorth - SHELL_PADDING, -GLOBE_RADIUS * 1.15),
    east: 0,
  })
  const end = localToWorld(basis, {
    forward: 0,
    north: Math.max(safeMaxNorth + SHELL_PADDING, GLOBE_RADIUS * 1.15),
    east: 0,
  })

  return {
    start: tuple3(start),
    end: tuple3(end),
  }
}

function buildShell(
  basis: FrameBasis,
  projection: ProjectionDefinition,
  bounds: LocalBounds,
  coneEmbedding: ConeEmbedding | null,
) {
  if (!Number.isFinite(bounds.minNorth) || !Number.isFinite(bounds.maxNorth)) {
    return null
  }

  switch (projection.visualizationSurface) {
    case 'plane': {
      const minEast = bounds.minEast - SHELL_PADDING
      const maxEast = bounds.maxEast + SHELL_PADDING
      const minNorth = bounds.minNorth - SHELL_PADDING
      const maxNorth = bounds.maxNorth + SHELL_PADDING
      const corners = [
        localToWorld(basis, {
          forward: PLANE_SURFACE_OFFSET,
          north: minNorth,
          east: minEast,
        }),
        localToWorld(basis, {
          forward: PLANE_SURFACE_OFFSET,
          north: minNorth,
          east: maxEast,
        }),
        localToWorld(basis, {
          forward: PLANE_SURFACE_OFFSET,
          north: maxNorth,
          east: maxEast,
        }),
        localToWorld(basis, {
          forward: PLANE_SURFACE_OFFSET,
          north: maxNorth,
          east: minEast,
        }),
      ].map(tuple3) as [
        [number, number, number],
        [number, number, number],
        [number, number, number],
        [number, number, number],
      ]

      return {
        type: 'plane' as const,
        corners,
      }
    }
    case 'cylinder': {
      const center = localToWorld(basis, {
        forward: 0,
        north: (bounds.minNorth + bounds.maxNorth) * 0.5,
        east: 0,
      })
      const quaternion = makeQuaternion(
        basis.forward,
        basis.north,
        basis.east,
      )

      return {
        type: 'cylinder' as const,
        center: tuple3(center),
        quaternion: tuple4(quaternion),
        radius: Math.max(0.1, GLOBE_RADIUS - SHELL_INSET),
        height: Math.max(
          0.2,
          bounds.maxNorth - bounds.minNorth + SHELL_PADDING * 2,
        ),
      }
    }
    case 'cone': {
      if (!coneEmbedding) {
        return null
      }

      const maxNorth = Math.min(
        coneEmbedding.apexNorth - SHELL_PADDING * 0.5,
        bounds.maxNorth + SHELL_PADDING,
      )
      const minNorth = bounds.minNorth - SHELL_PADDING
      const radiusAt = (north: number) =>
        Math.max(
          0,
          (coneEmbedding.apexNorth - north) *
            Math.tan(coneEmbedding.alpha) -
            SHELL_INSET,
        )
      const topRadius = radiusAt(maxNorth)
      const bottomRadius = radiusAt(minNorth)
      const center = localToWorld(basis, {
        forward: 0,
        north: (minNorth + maxNorth) * 0.5,
        east: 0,
      })
      const quaternion = makeQuaternion(
        basis.forward,
        basis.north,
        basis.east,
      )

      return {
        type: 'cone' as const,
        center: tuple3(center),
        quaternion: tuple4(quaternion),
        topRadius,
        bottomRadius,
        height: Math.max(0.2, maxNorth - minNorth),
      }
    }
    default:
      return null
  }
}

function expandBoundsFromFrameOutline(
  projection: ProjectionDefinition,
  surfaceProjector: SurfaceProjector,
  bounds: LocalBounds,
) {
  const frameOutline = getProjectionFrameOutline(projection)

  if (!frameOutline) {
    return
  }

  for (const point of frameOutline) {
    const localPoint = surfaceProjector.project(point)

    if (!localPoint) {
      continue
    }

    expandLocalBounds(bounds, localPoint)
  }
}

function hasProjectionDiscontinuity(
  previous: Pick<ForwardProjectionResult, 'regionId' | 'seamCoord'>,
  current: Pick<ForwardProjectionResult, 'regionId' | 'seamCoord'>,
) {
  return (
    (previous.regionId &&
      current.regionId &&
      previous.regionId !== current.regionId) ||
    (typeof previous.seamCoord === 'number' &&
      typeof current.seamCoord === 'number' &&
      Math.abs(previous.seamCoord - current.seamCoord) > Math.PI)
  )
}

function projectGeoPointToSurfaceLocal(
  projection: ProjectionDefinition,
  frame: ProjectionFrame,
  globeQuaternion: Quaternion,
  surfaceProjector: SurfaceProjector,
  point: GeoPoint,
) {
  const rotatedPoint = vector3ToGeoPoint(
    latLonToVector3(point).applyQuaternion(globeQuaternion),
  )
  const projected = projectGeoPoint(projection, rotatedPoint, frame)

  if (!projected.visible) {
    return null
  }

  const localPoint = surfaceProjector.project(projected)

  if (!localPoint) {
    return null
  }

  return {
    raw: projected,
    local: localPoint,
  }
}

function appendProjectedGeoPathSegments(
  projection: ProjectionDefinition,
  frame: ProjectionFrame,
  globeQuaternion: Quaternion,
  surfaceProjector: SurfaceProjector,
  bounds: LocalBounds,
  points: GeoPoint[],
  storedSegments: StoredSurfaceSegment[],
) {
  let previous: {
    raw: ForwardProjectionResult
    local: SurfaceLocalPoint
  } | null = null

  for (const point of points) {
    const current = projectGeoPointToSurfaceLocal(
      projection,
      frame,
      globeQuaternion,
      surfaceProjector,
      point,
    )

    if (!current) {
      previous = null
      continue
    }

    expandLocalBounds(bounds, current.local)

    if (previous && !hasProjectionDiscontinuity(previous.raw, current.raw)) {
      storedSegments.push({
        start: previous.local,
        end: current.local,
      })
    }

    previous = current
  }
}

export function buildProjectionVisualizationModel(
  projection: ProjectionDefinition,
  frame: ProjectionFrame,
  globeOrientation: GlobeOrientation,
  selection: GeoPoint | null,
  curveOverlay: CurveOverlayInput | null = null,
) {
  const globeQuaternion = createDisplayGlobeQuaternion(globeOrientation)
  const basis = getFrameBasis(frame)
  const surfaceProjector = createSurfaceProjector(projection)
  const graticulePositions: number[] = []
  const curveSurfacePositions: number[] = []
  const bounds = createLocalBounds()
  const storedGraticuleSegments: StoredSurfaceSegment[] = []
  const storedCurveSegments: StoredSurfaceSegment[] = []
  const storedCurveEndpoints: SurfaceLocalPoint[] = []

  expandBoundsFromFrameOutline(projection, surfaceProjector, bounds)

  for (let lineIndex = 0; lineIndex < baseMapMesh.graticuleLines.length; lineIndex += 1) {
    const vectorLine = BASE_GRATICULE_LINE_VECTORS[lineIndex]
    let previous: {
      raw: ForwardProjectionResult
      local: SurfaceLocalPoint
    } | null = null

    for (let pointIndex = 0; pointIndex < vectorLine.length; pointIndex += 1) {
      const rotatedPoint = vector3ToGeoPoint(
        vectorLine[pointIndex].clone().applyQuaternion(globeQuaternion),
      )
      const projected = projectGeoPoint(projection, rotatedPoint, frame)

      if (!projected.visible) {
        previous = null
        continue
      }

      const localPoint = surfaceProjector.project(projected)

      if (!localPoint) {
        previous = null
        continue
      }

      expandLocalBounds(bounds, localPoint)
      const current = {
        raw: projected,
        local: localPoint,
      }

      if (previous && !hasProjectionDiscontinuity(previous.raw, projected)) {
        storedGraticuleSegments.push({
          start: previous.local,
          end: current.local,
        })
      }

      previous = current
    }
  }

  if (curveOverlay) {
    for (const segment of curveOverlay.segments) {
      appendProjectedGeoPathSegments(
        projection,
        frame,
        globeQuaternion,
        surfaceProjector,
        bounds,
        segment,
        storedCurveSegments,
      )
    }

    for (const point of curveOverlay.endpoints) {
      const surfacePoint = projectGeoPointToSurfaceLocal(
        projection,
        frame,
        globeQuaternion,
        surfaceProjector,
        point,
      )

      if (!surfacePoint) {
        continue
      }

      expandLocalBounds(bounds, surfacePoint.local)
      storedCurveEndpoints.push(surfacePoint.local)
    }
  }

  for (const segment of storedGraticuleSegments) {
    const displayStart = orientSurfacePointForDisplay(
      projection,
      segment.start,
      bounds,
    )
    const displayEnd = orientSurfacePointForDisplay(
      projection,
      segment.end,
      bounds,
    )
    const worldStart = localToWorld(basis, displayStart)
    const worldEnd = localToWorld(basis, displayEnd)

    graticulePositions.push(
      worldStart.x,
      worldStart.y,
      worldStart.z,
      worldEnd.x,
      worldEnd.y,
      worldEnd.z,
    )
  }

  for (const segment of storedCurveSegments) {
    const displayStart = orientSurfacePointForDisplay(
      projection,
      segment.start,
      bounds,
    )
    const displayEnd = orientSurfacePointForDisplay(
      projection,
      segment.end,
      bounds,
    )
    const worldStart = localToWorld(basis, displayStart)
    const worldEnd = localToWorld(basis, displayEnd)

    curveSurfacePositions.push(
      worldStart.x,
      worldStart.y,
      worldStart.z,
      worldEnd.x,
      worldEnd.y,
      worldEnd.z,
    )
  }

  const curveSurfaceEndpoints = storedCurveEndpoints.map((point) =>
    tuple3(
      localToWorld(
        basis,
        orientSurfacePointForDisplay(projection, point, bounds),
      ),
    ),
  )

  const shell = buildShell(
    basis,
    projection,
    bounds,
    surfaceProjector.coneEmbedding,
  )
  const sourcePoint = buildSourcePoint(basis, projection)
  const sourceLine =
    projection.visualizationMode === 'line-source'
      ? buildSourceLine(basis, bounds.minNorth, bounds.maxNorth)
      : null
  let selectionSurfacePoint: [number, number, number] | null = null
  let selectionRay: { start: [number, number, number]; end: [number, number, number] } | null =
    null

  if (selection) {
    const rotatedVector = latLonToVector3(selection).applyQuaternion(globeQuaternion)
    const projected = projectGeoPoint(projection, vector3ToGeoPoint(rotatedVector), frame)

    if (projected.visible) {
      const localSurfacePoint = surfaceProjector.project(projected)

      if (localSurfacePoint) {
        const displaySurfacePoint = orientSurfacePointForDisplay(
          projection,
          localSurfacePoint,
          bounds,
        )
        const worldSurfacePoint = localToWorld(basis, displaySurfacePoint)
        const worldGlobePoint = rotatedVector.clone().normalize().multiplyScalar(
          GLOBE_PICK_RADIUS,
        )

        selectionSurfacePoint = tuple3(worldSurfacePoint)
        selectionRay = {
          start: tuple3(worldGlobePoint),
          end: tuple3(worldSurfacePoint),
        }
      }
    }
  }

  return {
    graticulePositions: new Float32Array(graticulePositions),
    curveSurfacePositions: new Float32Array(curveSurfacePositions),
    curveSurfaceEndpoints,
    shell,
    translucentGlobe: false,
    sourcePoint: sourcePoint ? tuple3(sourcePoint) : null,
    sourceLine,
    selectionSurfacePoint,
    selectionRay,
  } satisfies ProjectionVisualizationModel
}
