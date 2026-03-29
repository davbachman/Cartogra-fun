import { Vector2, Vector3 } from 'three'
import { baseMapMesh } from './mesh'
import {
  barycentricWeights,
  createNoRollQuaternion,
  interpolateGeoPoint,
  latLonToVector3,
  vector3ToGeoPoint,
} from './math'
import { getProjectionFrameOutline, projectGeoPoint } from './projections'
import type {
  ForwardProjectionResult,
  GeoPoint,
  GlobeOrientation,
  ProjectionDefinition,
  ProjectionFrame,
  Size,
} from './types'

interface RawVertexProjection extends ForwardProjectionResult {
  sourceGeo: GeoPoint
  sourceVector: Vector3
  rotatedVector: Vector3
}

interface ScreenVertexProjection extends RawVertexProjection {
  screenX: number
  screenY: number
}

export interface MapSceneTriangle {
  points: [Vector2, Vector2, Vector2]
  texturePoints: [Vector2, Vector2, Vector2]
  vectors: [Vector3, Vector3, Vector3]
}

export interface MapScene {
  triangles: MapSceneTriangle[]
  graticuleLines: Vector2[][]
  frameOutline: Vector2[] | null
  projectGeoToScreen: (point: GeoPoint) => Vector2 | null
  rawToScreen: (point: Pick<Vector2, 'x' | 'y'>) => Vector2
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

const EDGE_CLIP_STEPS = 18

function hasProjectionDiscontinuity(vertices: RawVertexProjection[]) {
  const regionIds = vertices
    .map((vertex) => vertex.regionId)
    .filter((value): value is string => Boolean(value))

  if (regionIds.length > 0 && new Set(regionIds).size > 1) {
    return true
  }

  const seamCoords = vertices
    .map((vertex) => vertex.seamCoord)
    .filter((value): value is number => typeof value === 'number')

  if (seamCoords.length > 1) {
    const seamSpan = Math.max(...seamCoords) - Math.min(...seamCoords)

    if (seamSpan > Math.PI) {
      return true
    }
  }

  return vertices.some(
    (vertex) => !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y),
  )
}

function isTriangleContinuous(vertices: [RawVertexProjection, RawVertexProjection, RawVertexProjection]) {
  if (vertices.some((vertex) => !vertex.visible)) {
    return false
  }

  return !hasProjectionDiscontinuity(vertices)
}

function createTexturePoint(point: GeoPoint) {
  return new Vector2((point.lonDeg + 180) / 360, (90 - point.latDeg) / 180)
}

function interpolateUnitVector(start: Vector3, end: Vector3, t: number) {
  const blended = new Vector3().lerpVectors(start, end, t)

  if (blended.lengthSq() < 1e-12) {
    return start.clone()
  }

  return blended.normalize()
}

function projectVertexFromVectors(
  projection: ProjectionDefinition,
  frame: ProjectionFrame,
  sourceVector: Vector3,
  rotatedVector: Vector3,
): RawVertexProjection {
  const sourceGeo = vector3ToGeoPoint(sourceVector)
  const rotatedGeo = vector3ToGeoPoint(rotatedVector)

  return {
    ...projectGeoPoint(projection, rotatedGeo, frame),
    sourceGeo,
    sourceVector,
    rotatedVector,
  }
}

function bisectVisibleEdge(
  projection: ProjectionDefinition,
  frame: ProjectionFrame,
  inside: RawVertexProjection,
  outside: RawVertexProjection,
) {
  let low = 0
  let high = 1
  let best = inside

  for (let step = 0; step < EDGE_CLIP_STEPS; step += 1) {
    const t = (low + high) * 0.5
    const sourceVector = interpolateUnitVector(
      inside.sourceVector,
      outside.sourceVector,
      t,
    )
    const rotatedVector = interpolateUnitVector(
      inside.rotatedVector,
      outside.rotatedVector,
      t,
    )
    const candidate = projectVertexFromVectors(
      projection,
      frame,
      sourceVector,
      rotatedVector,
    )

    if (candidate.visible) {
      low = t
      best = candidate
    } else {
      high = t
    }
  }

  return best
}

function clipTriangleToVisibleRegion(
  projection: ProjectionDefinition,
  frame: ProjectionFrame,
  vertices: [RawVertexProjection, RawVertexProjection, RawVertexProjection],
) {
  const clipped: RawVertexProjection[] = []
  let previous = vertices[vertices.length - 1]

  for (const current of vertices) {
    if (current.visible) {
      if (!previous.visible) {
        clipped.push(bisectVisibleEdge(projection, frame, current, previous))
      }

      clipped.push(current)
    } else if (previous.visible) {
      clipped.push(bisectVisibleEdge(projection, frame, previous, current))
    }

    previous = current
  }

  if (clipped.length < 3 || hasProjectionDiscontinuity(clipped)) {
    return []
  }

  const triangles: [RawVertexProjection, RawVertexProjection, RawVertexProjection][] = []

  for (let index = 1; index < clipped.length - 1; index += 1) {
    triangles.push([clipped[0], clipped[index], clipped[index + 1]])
  }

  return triangles
}

function createFit(
  projectedVertices: RawVertexProjection[],
  size: Size,
  rawFrameOutline: Vector2[] | null,
) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  const outlinePoints = rawFrameOutline ?? []

  if (outlinePoints.length > 0) {
    for (const point of outlinePoints) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        continue
      }

      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
  } else {
    for (const vertex of projectedVertices) {
      if (!vertex.visible || !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) {
        continue
      }

      minX = Math.min(minX, vertex.x)
      minY = Math.min(minY, vertex.y)
      maxX = Math.max(maxX, vertex.x)
      maxY = Math.max(maxY, vertex.y)
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    for (const vertex of projectedVertices) {
      if (!vertex.visible || !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) {
        continue
      }

      minX = Math.min(minX, vertex.x)
      minY = Math.min(minY, vertex.y)
      maxX = Math.max(maxX, vertex.x)
      maxY = Math.max(maxY, vertex.y)
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return {
      minX: -1,
      minY: -1,
      maxX: 1,
      maxY: 1,
      scale: 1,
      offsetX: size.width * 0.5,
      offsetY: size.height * 0.5,
    }
  }

  const padding = 28
  const spanX = Math.max(maxX - minX, 1e-6)
  const spanY = Math.max(maxY - minY, 1e-6)
  const scale = Math.min(
    (size.width - padding * 2) / spanX,
    (size.height - padding * 2) / spanY,
  )

  return {
    minX,
    minY,
    maxX,
    maxY,
    scale,
    offsetX: size.width * 0.5 - ((minX + maxX) * 0.5) * scale,
    offsetY: size.height * 0.5 + ((minY + maxY) * 0.5) * scale,
  }
}

function pointInPolygon(point: Vector2, polygon: Vector2[]) {
  let inside = false

  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = polygon[currentIndex]
    const previous = polygon[previousIndex]
    const crossesScanline =
      current.y > point.y !== previous.y > point.y

    if (!crossesScanline) {
      continue
    }

    const intersectionX =
      previous.x +
      ((point.y - previous.y) * (current.x - previous.x)) /
        (current.y - previous.y)

    if (point.x < intersectionX) {
      inside = !inside
    }
  }

  return inside
}

function toScreenCoordinates(
  raw: RawVertexProjection,
  fit: ReturnType<typeof createFit>,
) {
  return {
    ...raw,
    screenX: fit.offsetX + raw.x * fit.scale,
    screenY: fit.offsetY - raw.y * fit.scale,
  }
}

function buildGraticuleLines(
  projection: ProjectionDefinition,
  frame: ProjectionFrame,
  globeOrientation: GlobeOrientation,
  size: Size,
  fit: ReturnType<typeof createFit>,
) {
  const lines: Vector2[][] = []
  const maxJump = Math.max(size.width, size.height) * 0.32
  const globeQuaternion = createNoRollQuaternion(globeOrientation)

  for (const rawLine of baseMapMesh.graticuleLines) {
    let current: Vector2[] = []
    let previous: ScreenVertexProjection | null = null

    for (const point of rawLine) {
      const rotatedPoint = vector3ToGeoPoint(
        latLonToVector3(point).applyQuaternion(globeQuaternion),
      )
      const projected = projectGeoPoint(projection, rotatedPoint, frame)

      if (!projected.visible) {
        if (current.length > 1) {
          lines.push(current)
        }

        current = []
        previous = null
        continue
      }

      const screenPoint = toScreenCoordinates(
        {
          ...projected,
          sourceGeo: point,
          sourceVector: new Vector3(),
          rotatedVector: new Vector3(),
        },
        fit,
      )
      const currentPoint = new Vector2(screenPoint.screenX, screenPoint.screenY)

      if (
        previous &&
        ((previous.regionId && projected.regionId && previous.regionId !== projected.regionId) ||
          (typeof previous.seamCoord === 'number' &&
            typeof projected.seamCoord === 'number' &&
            Math.abs(previous.seamCoord - projected.seamCoord) > Math.PI) ||
          Math.hypot(
            currentPoint.x - previous.screenX,
            currentPoint.y - previous.screenY,
          ) > maxJump)
      ) {
        if (current.length > 1) {
          lines.push(current)
        }

        current = []
      }

      current.push(currentPoint)
      previous = screenPoint
    }

    if (current.length > 1) {
      lines.push(current)
    }
  }

  return lines
}

export function buildMapScene(
  projection: ProjectionDefinition,
  frame: ProjectionFrame,
  globeOrientation: GlobeOrientation,
  size: Size,
) {
  const globeQuaternion = createNoRollQuaternion(globeOrientation)
  const rawFrameOutline = getProjectionFrameOutline(projection)
  const rawVertices: RawVertexProjection[] = baseMapMesh.vertices.map((vertex) => {
    const rotatedVector = vertex.vector.clone().applyQuaternion(globeQuaternion)

    return {
      ...projectGeoPoint(projection, vector3ToGeoPoint(rotatedVector), frame),
      sourceGeo: vertex.geo,
      sourceVector: vertex.vector,
      rotatedVector,
    }
  })
  const fit = createFit(rawVertices, size, rawFrameOutline)
  const screenVertices = rawVertices.map((vertex) => toScreenCoordinates(vertex, fit))
  const frameOutline =
    rawFrameOutline?.map(
      (point) =>
        new Vector2(
          fit.offsetX + point.x * fit.scale,
          fit.offsetY - point.y * fit.scale,
        ),
    ) ?? null
  const triangles: MapSceneTriangle[] = []

  for (const triangle of baseMapMesh.triangles) {
    const a = screenVertices[triangle.indices[0]]
    const b = screenVertices[triangle.indices[1]]
    const c = screenVertices[triangle.indices[2]]
    const vertices: [ScreenVertexProjection, ScreenVertexProjection, ScreenVertexProjection] = [
      a,
      b,
      c,
    ]
    const clippedTriangles = rawFrameOutline
      ? clipTriangleToVisibleRegion(projection, frame, vertices)
      : isTriangleContinuous(vertices)
        ? [vertices]
        : []

    for (const clippedTriangle of clippedTriangles) {
      const [first, second, third] = clippedTriangle.map((vertex) =>
        toScreenCoordinates(vertex, fit),
      ) as [
        ScreenVertexProjection,
        ScreenVertexProjection,
        ScreenVertexProjection,
      ]

      triangles.push({
        points: [
          new Vector2(first.screenX, first.screenY),
          new Vector2(second.screenX, second.screenY),
          new Vector2(third.screenX, third.screenY),
        ],
        texturePoints: [
          createTexturePoint(first.sourceGeo),
          createTexturePoint(second.sourceGeo),
          createTexturePoint(third.sourceGeo),
        ],
        vectors: [first.sourceVector, second.sourceVector, third.sourceVector],
      })
    }
  }

  const graticuleLines = buildGraticuleLines(
    projection,
    frame,
    globeOrientation,
    size,
    fit,
  )

  return {
    triangles,
    graticuleLines,
    frameOutline,
    bounds: {
      minX: fit.minX,
      minY: fit.minY,
      maxX: fit.maxX,
      maxY: fit.maxY,
    },
    rawToScreen(point: Pick<Vector2, 'x' | 'y'>) {
      return new Vector2(
        fit.offsetX + point.x * fit.scale,
        fit.offsetY - point.y * fit.scale,
      )
    },
    projectGeoToScreen(point: GeoPoint) {
      const rotatedPoint = vector3ToGeoPoint(
        latLonToVector3(point).applyQuaternion(globeQuaternion),
      )
      const projected = projectGeoPoint(projection, rotatedPoint, frame)

      if (!projected.visible) {
        return null
      }

      return new Vector2(
        fit.offsetX + projected.x * fit.scale,
        fit.offsetY - projected.y * fit.scale,
      )
    },
  } satisfies MapScene
}

export function pickGeoPointFromScene(
  scene: MapScene,
  pointerX: number,
  pointerY: number,
) {
  const pointer = new Vector2(pointerX, pointerY)

  if (
    scene.frameOutline &&
    scene.frameOutline.length >= 3 &&
    !pointInPolygon(pointer, scene.frameOutline)
  ) {
    return null
  }

  for (const triangle of scene.triangles) {
    const weights = barycentricWeights(
      pointer,
      triangle.points[0],
      triangle.points[1],
      triangle.points[2],
    )

    if (!weights) {
      continue
    }

    return interpolateGeoPoint(triangle.vectors, weights)
  }

  return null
}
