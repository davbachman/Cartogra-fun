import { useEffect, useMemo } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
} from 'three'
import {
  buildProjectionVisualizationModel,
  type ProjectionVisualizationModel,
} from '../lib/projectionVisualization'
import type {
  GeoPoint,
  GeodesicSelection,
  GlobeOrientation,
  ProjectionDefinition,
  ProjectionFrame,
} from '../lib/types'

type ProjectionVisualizationSurfaceProps = {
  projection: ProjectionDefinition
  projectionFrame: ProjectionFrame
  globeOrientation: GlobeOrientation
  selection: GeoPoint | null
  geodesicSelection: GeodesicSelection | null
  globeCurveSegments: GeoPoint[][]
}

function createCurveSegmentGeometry(boundaryPositions: number[][]) {
  const geometry = new BufferGeometry()
  const positions = new Float32Array(Math.max(0, (boundaryPositions.length - 1) * 6))

  for (let index = 1; index < boundaryPositions.length; index += 1) {
    const offset = (index - 1) * 6
    const start = boundaryPositions[index - 1]
    const end = boundaryPositions[index]

    positions[offset] = start[0]
    positions[offset + 1] = start[1]
    positions[offset + 2] = start[2]
    positions[offset + 3] = end[0]
    positions[offset + 4] = end[1]
    positions[offset + 5] = end[2]
  }

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))

  return geometry
}

function createQuadGeometry(
  corners: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ],
) {
  const geometry = new BufferGeometry()
  const positions = new Float32Array([
    ...corners[0],
    ...corners[1],
    ...corners[2],
    ...corners[0],
    ...corners[2],
    ...corners[3],
  ])

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()

  return geometry
}

function ProjectionRay({
  start,
  end,
  color,
  opacity = 0.95,
}: {
  start: [number, number, number]
  end: [number, number, number]
  color: string
  opacity?: number
}) {
  const geometry = useMemo(() => {
    return createCurveSegmentGeometry([start, end])
  }, [end, start])

  useEffect(() => {
    return () => {
      geometry.dispose()
    }
  }, [geometry])

  return (
    <lineSegments geometry={geometry} renderOrder={13}>
      <lineBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} />
    </lineSegments>
  )
}

function ProjectionMarker({
  point,
  radius = 0.024,
  color = '#fff1cd',
  emissive = '#ffbf69',
}: {
  point: [number, number, number]
  radius?: number
  color?: string
  emissive?: string
}) {
  return (
    <mesh position={point} renderOrder={14}>
      <sphereGeometry args={[radius, 20, 20]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={1.05}
        depthWrite={false}
      />
    </mesh>
  )
}

function ProjectionShell({
  model,
}: {
  model: ProjectionVisualizationModel
}) {
  const shell = model.shell
  const planeGeometry = useMemo(() => {
    if (!shell || shell.type !== 'plane') {
      return null
    }

    return createQuadGeometry(shell.corners)
  }, [shell])

  useEffect(() => {
    return () => {
      planeGeometry?.dispose()
    }
  }, [planeGeometry])

  if (!shell) {
    return null
  }

  if (shell.type === 'plane') {
    if (!planeGeometry) {
      return null
    }

    return (
      <mesh geometry={planeGeometry} renderOrder={1}>
        <meshBasicMaterial
          color="#0f2c42"
          side={DoubleSide}
          transparent
          opacity={0.035}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    )
  }

  if (shell.type === 'cylinder') {
    return (
      <mesh
        position={shell.center}
        quaternion={shell.quaternion}
        renderOrder={1}
      >
        <cylinderGeometry args={[shell.radius, shell.radius, shell.height, 96, 1, true]} />
        <meshBasicMaterial
          color="#8bd1ff"
          side={DoubleSide}
          transparent
          opacity={0.02}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    )
  }

  return (
    <mesh
      position={shell.center}
      quaternion={shell.quaternion}
      renderOrder={1}
    >
      <cylinderGeometry
        args={[shell.topRadius, shell.bottomRadius, shell.height, 96, 1, true]}
      />
      <meshBasicMaterial
        color="#8bd1ff"
        side={DoubleSide}
        transparent
        opacity={0.02}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}

function syncDynamicGeometryAttribute(
  geometry: BufferGeometry,
  name: 'position' | 'uv',
  values: Float32Array,
  itemSize: number,
) {
  const currentAttribute = geometry.getAttribute(name)

  if (
    currentAttribute instanceof BufferAttribute &&
    currentAttribute.array instanceof Float32Array &&
    currentAttribute.itemSize === itemSize &&
    currentAttribute.array.length >= values.length
  ) {
    currentAttribute.array.set(values, 0)
    currentAttribute.needsUpdate = true
    return
  }

  const nextCapacity = Math.max(
    values.length,
    currentAttribute instanceof BufferAttribute &&
      currentAttribute.array instanceof Float32Array
      ? Math.ceil(currentAttribute.array.length * 1.5)
      : 0,
  )
  const buffer = new Float32Array(nextCapacity)

  buffer.set(values)
  const nextAttribute = new BufferAttribute(buffer, itemSize)

  nextAttribute.setUsage(DynamicDrawUsage)
  geometry.setAttribute(name, nextAttribute)
}

export default function ProjectionVisualizationSurface({
  projection,
  projectionFrame,
  globeOrientation,
  selection,
  geodesicSelection,
  globeCurveSegments,
}: ProjectionVisualizationSurfaceProps) {
  const model = useMemo(() => {
    return buildProjectionVisualizationModel(
      projection,
      projectionFrame,
      globeOrientation,
      selection,
      geodesicSelection && geodesicSelection.points.length >= 2
        ? {
            endpoints: geodesicSelection.points,
            segments: globeCurveSegments,
          }
        : null,
    )
  }, [
    geodesicSelection,
    globeCurveSegments,
    globeOrientation,
    projection,
    projectionFrame,
    selection,
  ])
  const graticuleGeometry = useMemo(() => new BufferGeometry(), [])
  const curveGeometry = useMemo(() => new BufferGeometry(), [])

  useEffect(() => {
    return () => {
      graticuleGeometry.dispose()
      curveGeometry.dispose()
    }
  }, [curveGeometry, graticuleGeometry])

  useEffect(() => {
    syncDynamicGeometryAttribute(
      graticuleGeometry,
      'position',
      model.graticulePositions,
      3,
    )
    graticuleGeometry.setDrawRange(0, model.graticulePositions.length / 3)
  }, [graticuleGeometry, model.graticulePositions])

  useEffect(() => {
    syncDynamicGeometryAttribute(
      curveGeometry,
      'position',
      model.curveSurfacePositions,
      3,
    )
    curveGeometry.setDrawRange(0, model.curveSurfacePositions.length / 3)
  }, [curveGeometry, model.curveSurfacePositions])

  return (
    <>
      <ProjectionShell model={model} />

      {model.graticulePositions.length > 0 ? (
        <lineSegments geometry={graticuleGeometry} renderOrder={4} frustumCulled={false}>
          <lineBasicMaterial
            color="#c9d7e4"
            transparent
            opacity={0.58}
            toneMapped={false}
          />
        </lineSegments>
      ) : null}

      {model.curveSurfacePositions.length > 0 ? (
        <lineSegments geometry={curveGeometry} renderOrder={10} frustumCulled={false}>
          <lineBasicMaterial
            color="#fff1b8"
            transparent
            opacity={1}
            toneMapped={false}
          />
        </lineSegments>
      ) : null}
      {model.curveSurfaceEndpoints.map((point, index) => (
        <ProjectionMarker
          key={`${point.join(':')}:${index}`}
          point={point}
          radius={0.018}
        />
      ))}

      {model.sourcePoint ? (
        <ProjectionMarker
          point={model.sourcePoint}
          radius={0.028}
          color="#fff6d9"
          emissive="#7ef1ff"
        />
      ) : null}
      {model.sourceLine ? (
        <>
          <ProjectionRay
            start={model.sourceLine.start}
            end={model.sourceLine.end}
            color="#88f0ff"
            opacity={0.9}
          />
          <ProjectionMarker
            point={model.sourceLine.start}
            radius={0.018}
            color="#e9fbff"
            emissive="#7ef1ff"
          />
          <ProjectionMarker
            point={model.sourceLine.end}
            radius={0.018}
            color="#e9fbff"
            emissive="#7ef1ff"
          />
        </>
      ) : null}
      {model.selectionRay ? (
        <ProjectionRay
          start={model.selectionRay.start}
          end={model.selectionRay.end}
          color="#fff1b8"
          opacity={1}
        />
      ) : null}
      {model.selectionSurfacePoint ? (
        <ProjectionMarker point={model.selectionSurfacePoint} radius={0.021} />
      ) : null}
    </>
  )
}
