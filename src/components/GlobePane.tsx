import { Canvas, type ThreeEvent } from '@react-three/fiber'
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  lazy,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  Mesh,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { IndicatrixMetrics } from './IndicatrixMetrics'
import {
  getEarthTextureCanvas,
  useEarthTextureVersion,
  type EarthTextureRequest,
} from '../lib/earthTexture'
import { sampleGeodesicArc, sampleMapLinePreimage } from '../lib/geodesic'
import {
  analyzeIndicatrixAtPoint,
  sampleGlobeIndicatrixBoundary,
} from '../lib/indicatrix'
import { buildMapScene } from '../lib/mapScene'
import { baseMapMesh } from '../lib/mesh'
import {
  clamp,
  degToRad,
  latLonToVector3,
  vector3ToGeoPoint,
  wrapLongitudeDeg,
} from '../lib/math'
import { GLOBE_CURVE_RADIUS, GLOBE_RADIUS, INDICATRIX_SURFACE_RADIUS } from '../lib/globeConstants'
import {
  getProjectionDefinition,
  supportsProjectionVisualization,
} from '../lib/projections'
import type { GlobeOrientation } from '../lib/types'
import { useElementSize } from '../lib/useElementSize'
import { useAppStore } from '../lib/store'

type PointerCaptureTarget = EventTarget & {
  setPointerCapture: (pointerId: number) => void
  releasePointerCapture: (pointerId: number) => void
}

const STAR_POSITIONS = (() => {
  const positions = new Float32Array(2200 * 3)

  for (let index = 0; index < 2200; index += 1) {
    const radius = 14 + Math.random() * 10
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    const offset = index * 3

    positions[offset] = radius * Math.sin(phi) * Math.cos(theta)
    positions[offset + 1] = radius * Math.cos(phi)
    positions[offset + 2] = radius * Math.sin(phi) * Math.sin(theta)
  }

  return positions
})()

const GLOBE_CAMERA_DISTANCE = 4.05
const GLOBE_CAMERA_FOV = 30
const PROJECTION_ROTATION_DEG_PER_PIXEL = 0.3
const GEODESIC_MAP_SCENE_SIZE = { width: 1280, height: 720 }
const LazyProjectionVisualizationSurface = lazy(
  () => import('./ProjectionVisualizationSurface'),
)

function createSceneRotationQuaternion(
  azimuthDeg: number,
  elevationDeg: number,
) {
  const tilt = new Quaternion().setFromAxisAngle(
    new Vector3(1, 0, 0),
    -degToRad(elevationDeg),
  )
  const spin = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    -degToRad(azimuthDeg),
  )

  return tilt.multiply(spin).normalize()
}

function createDisplayGlobeRotationQuaternion(orientation: GlobeOrientation) {
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

function extractDisplayGlobeOrientation(quaternion: Quaternion): GlobeOrientation {
  const euler = new Euler().setFromQuaternion(quaternion, 'XYZ')
  return {
    azimuthDeg: wrapLongitudeDeg((-euler.y * 180) / Math.PI),
    elevationDeg: clamp((-euler.x * 180) / Math.PI, -75, 75),
    rollDeg: wrapLongitudeDeg((euler.z * 180) / Math.PI),
  }
}

const GLOBE_GRATICULE_POSITIONS = (() => {
  const positions: number[] = []

  for (const line of baseMapMesh.graticuleLines) {
    for (let index = 1; index < line.length; index += 1) {
      const start = latLonToVector3(line[index - 1], GLOBE_RADIUS * 1.001)
      const end = latLonToVector3(line[index], GLOBE_RADIUS * 1.001)

      positions.push(start.x, start.y, start.z, end.x, end.y, end.z)
    }
  }

  return new Float32Array(positions)
})()

function createIndicatrixFillGeometry(centerPosition: number[], boundaryPositions: number[][]) {
  const geometry = new BufferGeometry()
  const positions = new Float32Array((boundaryPositions.length + 1) * 3)
  const indices: number[] = []

  positions[0] = centerPosition[0]
  positions[1] = centerPosition[1]
  positions[2] = centerPosition[2]

  boundaryPositions.forEach((position, index) => {
    const offset = (index + 1) * 3

    positions[offset] = position[0]
    positions[offset + 1] = position[1]
    positions[offset + 2] = position[2]
  })

  for (let index = 0; index < boundaryPositions.length; index += 1) {
    indices.push(0, index + 1, ((index + 1) % boundaryPositions.length) + 1)
  }

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  return geometry
}

function createIndicatrixOutlineGeometry(boundaryPositions: number[][]) {
  const geometry = new BufferGeometry()
  const positions = new Float32Array(boundaryPositions.length * 3)

  boundaryPositions.forEach((position, index) => {
    const offset = index * 3

    positions[offset] = position[0]
    positions[offset + 1] = position[1]
    positions[offset + 2] = position[2]
  })

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))

  return geometry
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

function GlobeMarker({ point }: { point: { latDeg: number; lonDeg: number } }) {
  const position = useMemo(() => {
    const lifted = latLonToVector3(point, GLOBE_CURVE_RADIUS)

    return [lifted.x, lifted.y, lifted.z] as [number, number, number]
  }, [point])

  return (
    <mesh position={position} renderOrder={9}>
      <sphereGeometry args={[0.019, 18, 18]} />
      <meshStandardMaterial
        color="#fff1cd"
        emissive="#ffbf69"
        emissiveIntensity={0.95}
        depthWrite={false}
      />
    </mesh>
  )
}

function GlobeCurveSegment({
  points,
}: {
  points: Array<{ latDeg: number; lonDeg: number }>
}) {
  const positions = useMemo(() => {
    return points.map((point) => {
      const lifted = latLonToVector3(point, GLOBE_CURVE_RADIUS)

      return [lifted.x, lifted.y, lifted.z]
    })
  }, [points])
  const geometry = useMemo(() => {
    return createCurveSegmentGeometry(positions)
  }, [positions])

  useEffect(() => {
    return () => {
      geometry.dispose()
    }
  }, [geometry])

  return (
    <lineSegments geometry={geometry} renderOrder={8}>
      <lineBasicMaterial color="#fff1b8" transparent opacity={1} toneMapped={false} />
    </lineSegments>
  )
}

function GlobeCurveOverlay({
  endpoints,
  segments,
}: {
  endpoints: Array<{ latDeg: number; lonDeg: number }>
  segments: Array<Array<{ latDeg: number; lonDeg: number }>>
}) {
  if (endpoints.length === 0 && segments.length === 0) {
    return null
  }

  return (
    <>
      {segments.map((segment, index) =>
        segment.length > 1 ? (
          <GlobeCurveSegment key={`${index}-${segment.length}`} points={segment} />
        ) : null,
      )}
      {endpoints.map((point, index) => (
        <GlobeMarker
          key={`${point.latDeg.toFixed(4)}:${point.lonDeg.toFixed(4)}:${index}`}
          point={point}
        />
      ))}
    </>
  )
}

function IndicatrixPatch({
  point,
  boundary,
}: {
  point: { latDeg: number; lonDeg: number }
  boundary: Array<{ latDeg: number; lonDeg: number }>
}) {
  const centerPosition = useMemo(() => {
    const lifted = latLonToVector3(point, INDICATRIX_SURFACE_RADIUS)

    return [lifted.x, lifted.y, lifted.z]
  }, [point])
  const boundaryPositions = useMemo(() => {
    return boundary.map((boundaryPoint) => {
      const lifted = latLonToVector3(boundaryPoint, INDICATRIX_SURFACE_RADIUS)

      return [lifted.x, lifted.y, lifted.z]
    })
  }, [boundary])
  const fillGeometry = useMemo(() => {
    return createIndicatrixFillGeometry(centerPosition, boundaryPositions)
  }, [boundaryPositions, centerPosition])
  const outlineGeometry = useMemo(() => {
    return createIndicatrixOutlineGeometry(boundaryPositions)
  }, [boundaryPositions])

  useEffect(() => {
    return () => {
      fillGeometry.dispose()
      outlineGeometry.dispose()
    }
  }, [fillGeometry, outlineGeometry])

      return (
        <>
          <mesh geometry={fillGeometry} renderOrder={4}>
        <meshBasicMaterial
          color="#ffcb77"
          transparent
          opacity={0.46}
          side={DoubleSide}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-5}
          toneMapped={false}
        />
      </mesh>
      <mesh geometry={fillGeometry} renderOrder={5}>
        <meshBasicMaterial
          color="#8d3e16"
          transparent
          opacity={0.16}
          side={DoubleSide}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-4}
          toneMapped={false}
        />
      </mesh>
      <lineLoop geometry={outlineGeometry} renderOrder={6}>
        <lineBasicMaterial color="#fff4d4" transparent opacity={0.94} />
      </lineLoop>
      <mesh position={centerPosition as [number, number, number]} renderOrder={7}>
        <sphereGeometry args={[0.018, 18, 18]} />
        <meshStandardMaterial
          color="#fff1cd"
          emissive="#ffbf69"
          emissiveIntensity={0.9}
          depthWrite={false}
        />
      </mesh>
    </>
  )
}

function useGlobeTexture(textureRequest: EarthTextureRequest) {
  const textureVersion = useEarthTextureVersion()
  const texture = useMemo(() => {
    const earthTexture = new CanvasTexture(getEarthTextureCanvas(textureRequest))
    earthTexture.colorSpace = SRGBColorSpace
    earthTexture.name = `earth-texture-${textureVersion}-${textureRequest.showDayNight ? textureRequest.timestampMs : 'day'}`
    earthTexture.needsUpdate = true
    return earthTexture
  }, [textureRequest, textureVersion])

  useEffect(() => {
    return () => {
      texture.dispose()
    }
  }, [texture])

  return texture
}

function StarField() {
  const geometryRef = useRef<BufferGeometry | null>(null)

  useEffect(() => {
    if (!geometryRef.current) {
      return
    }

    geometryRef.current.setAttribute(
      'position',
      new BufferAttribute(STAR_POSITIONS, 3),
    )
  }, [])

  return (
    <points scale={1}>
      <bufferGeometry ref={geometryRef} />
      <pointsMaterial
        size={0.085}
        sizeAttenuation
        color="#b7dcff"
        transparent
        opacity={0.9}
      />
    </points>
  )
}

function GlobeGraticule() {
  const geometryRef = useRef<BufferGeometry | null>(null)

  useEffect(() => {
    if (!geometryRef.current) {
      return
    }

    geometryRef.current.setAttribute(
      'position',
      new BufferAttribute(GLOBE_GRATICULE_POSITIONS, 3),
    )
  }, [])

  return (
    <lineSegments>
      <bufferGeometry ref={geometryRef} />
      <lineBasicMaterial color="#f5f7fb" transparent opacity={0.7} />
    </lineSegments>
  )
}

function GlobeScene() {
  const meshRef = useRef<Mesh | null>(null)
  const viewTiltGroupRef = useRef<Group | null>(null)
  const viewSpinGroupRef = useRef<Group | null>(null)
  const globeTiltGroupRef = useRef<Group | null>(null)
  const globeSpinGroupRef = useRef<Group | null>(null)
  const globeRollGroupRef = useRef<Group | null>(null)
  const activeTool = useAppStore((state) => state.activeTool)
  const activeProjectionId = useAppStore((state) => state.activeProjectionId)
  const viewCamera = useAppStore((state) => state.viewCamera)
  const globeOrientation = useAppStore((state) => state.globeOrientation)
  const projectionFrame = useAppStore((state) => state.projectionFrame)
  const selection = useAppStore((state) => state.selection)
  const selectionSource = useAppStore((state) => state.selectionSource)
  const geodesicSelection = useAppStore((state) => state.geodesicSelection)
  const showProjectionVisualization = useAppStore(
    (state) => state.showProjectionVisualization,
  )
  const showDayNight = useAppStore((state) => state.showDayNight)
  const dayNightTimestampMs = useAppStore((state) => state.dayNightTimestampMs)
  const setSelection = useAppStore((state) => state.setSelection)
  const pushGeodesicPoint = useAppStore((state) => state.pushGeodesicPoint)
  const pointerState = useRef({
    pointerId: -1,
    moved: false,
  })
  const activeProjection = useMemo(() => {
    return getProjectionDefinition(activeProjectionId)
  }, [activeProjectionId])
  const textureRequest = useMemo(
    () => ({
      showDayNight,
      timestampMs: dayNightTimestampMs,
    }),
    [dayNightTimestampMs, showDayNight],
  )
  const texture = useGlobeTexture(textureRequest)
  const projectionVisualizationActive =
    showProjectionVisualization && supportsProjectionVisualization(activeProjection)
  const indicatrix = useMemo(() => {
    if (!selection || !selectionSource) {
      return null
    }

    return analyzeIndicatrixAtPoint(
      activeProjection,
      projectionFrame,
      globeOrientation,
      selection,
    )
  }, [
    activeProjection,
    globeOrientation,
    projectionFrame,
    selection,
    selectionSource,
  ])
  const globeIndicatrix = useMemo(() => {
    if (!selection || !selectionSource) {
      return null
    }

    return sampleGlobeIndicatrixBoundary(selection, indicatrix, selectionSource)
  }, [indicatrix, selection, selectionSource])
  const mapSceneForPreimage = useMemo(() => {
    if (
      !geodesicSelection ||
      geodesicSelection.source !== 'map' ||
      geodesicSelection.points.length < 2
    ) {
      return null
    }

    return buildMapScene(
      activeProjection,
      projectionFrame,
      globeOrientation,
      GEODESIC_MAP_SCENE_SIZE,
    )
  }, [activeProjection, geodesicSelection, globeOrientation, projectionFrame])
  const globeCurveSegments = useMemo(() => {
    if (!geodesicSelection || geodesicSelection.points.length < 2) {
      return []
    }

    if (geodesicSelection.source === 'globe') {
      return [
        sampleGeodesicArc(
          geodesicSelection.points[0],
          geodesicSelection.points[1],
        ),
      ]
    }

    if (!mapSceneForPreimage) {
      return []
    }

    return sampleMapLinePreimage(
      mapSceneForPreimage,
      geodesicSelection.points[0],
      geodesicSelection.points[1],
    )
  }, [geodesicSelection, mapSceneForPreimage])

  useLayoutEffect(() => {
    if (!viewTiltGroupRef.current || !viewSpinGroupRef.current) {
      return
    }

    // Keep view rotation no-roll: horizontal drag spins around the globe's
    // north/south axis, while vertical drag tilts that axis toward/away.
    viewTiltGroupRef.current.rotation.set(-degToRad(viewCamera.elevationDeg), 0, 0)
    viewSpinGroupRef.current.rotation.set(0, -degToRad(viewCamera.azimuthDeg), 0)
  }, [viewCamera])

  useLayoutEffect(() => {
    if (
      !globeTiltGroupRef.current ||
      !globeSpinGroupRef.current ||
      !globeRollGroupRef.current
    ) {
      return
    }

    globeTiltGroupRef.current.rotation.set(
      -degToRad(globeOrientation.elevationDeg),
      0,
      0,
    )
    globeSpinGroupRef.current.rotation.set(
      0,
      -degToRad(globeOrientation.azimuthDeg),
      0,
    )
    globeRollGroupRef.current.rotation.set(
      0,
      0,
      degToRad(globeOrientation.rollDeg ?? 0),
    )
  }, [globeOrientation])

  function beginDrag(event: ThreeEvent<PointerEvent>) {
    if (
      (activeTool !== 'select' && activeTool !== 'geodesic') ||
      event.button !== 0
    ) {
      return
    }

    const target = event.target as PointerCaptureTarget

    pointerState.current.pointerId = event.pointerId
    pointerState.current.moved = false
    target.setPointerCapture(event.pointerId)
  }

  function moveDrag(event: ThreeEvent<PointerEvent>) {
    if (
      pointerState.current.pointerId !== event.pointerId ||
      (activeTool !== 'select' && activeTool !== 'geodesic')
    ) {
      return
    }

    if (
      Math.abs(event.movementX) + Math.abs(event.movementY) > 1.5
    ) {
      pointerState.current.moved = true
    }
  }

  function endDrag(event: ThreeEvent<PointerEvent>) {
    if (pointerState.current.pointerId === event.pointerId) {
      const target = event.target as PointerCaptureTarget

      target.releasePointerCapture(event.pointerId)
      pointerState.current.pointerId = -1
    }

    if (
      (activeTool === 'select' || activeTool === 'geodesic') &&
      !pointerState.current.moved &&
      meshRef.current
    ) {
      const localPoint = meshRef.current.worldToLocal(event.point.clone())
      const point = vector3ToGeoPoint(localPoint)

      if (activeTool === 'select') {
        setSelection(point, 'globe')
      } else {
        pushGeodesicPoint(point, 'globe')
      }
    }

    pointerState.current.moved = false
  }

  return (
    <>
      <ambientLight intensity={1.15} />
      <directionalLight position={[2.6, 1.8, 2.4]} intensity={1.2} />
      <directionalLight position={[-3.2, -1.6, 1.4]} intensity={0.45} color="#66c7ff" />
      <group ref={viewTiltGroupRef}>
        <group ref={viewSpinGroupRef}>
          <StarField />

          {projectionVisualizationActive ? (
            <Suspense fallback={null}>
              <LazyProjectionVisualizationSurface
                projection={activeProjection}
                projectionFrame={projectionFrame}
                globeOrientation={globeOrientation}
                selection={selection}
                geodesicSelection={geodesicSelection}
                globeCurveSegments={globeCurveSegments}
              />
            </Suspense>
          ) : null}

          <group ref={globeTiltGroupRef}>
            <group ref={globeSpinGroupRef}>
              <group ref={globeRollGroupRef}>
                <mesh>
                  <sphereGeometry args={[GLOBE_RADIUS, 96, 96]} />
                  <meshBasicMaterial color="#000000" colorWrite={false} />
                </mesh>

                <mesh
                  ref={meshRef}
                  onPointerDown={beginDrag}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  <sphereGeometry args={[GLOBE_RADIUS, 96, 96]} />
                  {showDayNight ? (
                    <meshBasicMaterial
                      map={texture}
                      color="#ffffff"
                    />
                  ) : (
                    <meshStandardMaterial
                      map={texture}
                      roughness={1}
                      metalness={0}
                      color="#ffffff"
                    />
                  )}
                </mesh>

                <mesh scale={1.03}>
                  <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
                  <meshBasicMaterial
                    color="#7dd4ff"
                    opacity={0.09}
                    transparent
                    side={DoubleSide}
                    depthWrite={false}
                  />
                </mesh>

                <GlobeGraticule />

                {selection && selectionSource && globeIndicatrix ? (
                  <IndicatrixPatch point={selection} boundary={globeIndicatrix} />
                ) : null}
                {geodesicSelection ? (
                  <GlobeCurveOverlay
                    endpoints={geodesicSelection.points}
                    segments={globeCurveSegments}
                  />
                ) : null}
              </group>
            </group>
          </group>
        </group>
      </group>
    </>
  )
}

export function GlobePane() {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const rotationDragState = useRef({
    active: false,
    pointerId: -1,
    lastX: 0,
    lastY: 0,
  })
  const shellSize = useElementSize(shellRef)
  const activeProjectionId = useAppStore((state) => state.activeProjectionId)
  const activeTool = useAppStore((state) => state.activeTool)
  const fixProjection = useAppStore((state) => state.fixProjection)
  const viewCamera = useAppStore((state) => state.viewCamera)
  const globeOrientation = useAppStore((state) => state.globeOrientation)
  const projectionFrame = useAppStore((state) => state.projectionFrame)
  const selection = useAppStore((state) => state.selection)
  const selectionSource = useAppStore((state) => state.selectionSource)
  const setSelection = useAppStore((state) => state.setSelection)
  const clearGeodesicSelection = useAppStore(
    (state) => state.clearGeodesicSelection,
  )
  const nudgeViewCamera = useAppStore((state) => state.nudgeViewCamera)
  const setGlobeOrientation = useAppStore((state) => state.setGlobeOrientation)
  const stageSize = Math.max(
    0,
    Math.floor(Math.min(shellSize.width, shellSize.height) * 0.96),
  )
  const activeProjection = useMemo(() => {
    return getProjectionDefinition(activeProjectionId)
  }, [activeProjectionId])
  const indicatrix = useMemo(() => {
    if (!selection || !selectionSource) {
      return null
    }

    return analyzeIndicatrixAtPoint(
      activeProjection,
      projectionFrame,
      globeOrientation,
      selection,
    )
  }, [
    activeProjection,
    globeOrientation,
    projectionFrame,
    selection,
    selectionSource,
  ])
  const inversePatch = useMemo(() => {
    if (!selection || selectionSource !== 'map') {
      return null
    }

    return sampleGlobeIndicatrixBoundary(selection, indicatrix, selectionSource)
  }, [indicatrix, selection, selectionSource])

  function handleRotationPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 2) {
      return
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    rotationDragState.current.active = true
    rotationDragState.current.pointerId = event.pointerId
    rotationDragState.current.lastX = event.clientX
    rotationDragState.current.lastY = event.clientY
  }

  function handleRotationPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (
      !rotationDragState.current.active ||
      rotationDragState.current.pointerId !== event.pointerId
    ) {
      return
    }

    const deltaX = event.clientX - rotationDragState.current.lastX
    const deltaY = event.clientY - rotationDragState.current.lastY

    rotationDragState.current.lastX = event.clientX
    rotationDragState.current.lastY = event.clientY

    if (Math.abs(deltaX) < 0.1 && Math.abs(deltaY) < 0.1) {
      return
    }

    const deltaAzimuthDeg = -deltaX * PROJECTION_ROTATION_DEG_PER_PIXEL
    const deltaElevationDeg = -deltaY * PROJECTION_ROTATION_DEG_PER_PIXEL

    if (fixProjection) {
      const nextViewAzimuthDeg = wrapLongitudeDeg(
        viewCamera.azimuthDeg + deltaAzimuthDeg,
      )
      const nextViewElevationDeg = clamp(
        viewCamera.elevationDeg + deltaElevationDeg,
        -75,
        75,
      )
      const currentViewRotation = createSceneRotationQuaternion(
        viewCamera.azimuthDeg,
        viewCamera.elevationDeg,
      )
      const nextViewRotation = createSceneRotationQuaternion(
        nextViewAzimuthDeg,
        nextViewElevationDeg,
      )
      const currentGlobeRotation = createDisplayGlobeRotationQuaternion(
        globeOrientation,
      )
      const nextGlobeRotation = currentViewRotation
        .clone()
        .invert()
        .multiply(nextViewRotation)
        .multiply(currentGlobeRotation)

      setGlobeOrientation(extractDisplayGlobeOrientation(nextGlobeRotation))
    } else {
      nudgeViewCamera(deltaAzimuthDeg, deltaElevationDeg)
    }
  }

  function endRotationDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (
      !rotationDragState.current.active ||
      rotationDragState.current.pointerId !== event.pointerId
    ) {
      return
    }

    event.currentTarget.releasePointerCapture(event.pointerId)
    rotationDragState.current.active = false
    rotationDragState.current.pointerId = -1
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault()
  }

  return (
    <section className="pane pane-globe">
      <div className="pane-label">
        <span className="pane-title">Globe</span>
        <span className="pane-subtitle">Two-finger click-drag or right-drag to rotate; use fix projection to rotate the globe against a fixed map frame</span>
      </div>

      <div ref={shellRef} className="globe-stage-shell">
        {stageSize > 0 ? (
          <div
            className="globe-stage"
            style={{ width: `${stageSize}px`, height: `${stageSize}px` }}
            onPointerDown={handleRotationPointerDown}
            onPointerMove={handleRotationPointerMove}
            onPointerUp={endRotationDrag}
            onPointerCancel={endRotationDrag}
            onContextMenu={handleContextMenu}
          >
            <Canvas
              dpr={[1, 2]}
              gl={{ antialias: true, alpha: true }}
              camera={{ position: [0, 0, GLOBE_CAMERA_DISTANCE], fov: GLOBE_CAMERA_FOV }}
              onPointerMissed={() => {
                if (activeTool === 'select') {
                  setSelection(null)
                }

                if (activeTool === 'geodesic') {
                  clearGeodesicSelection()
                }
              }}
            >
              <color attach="background" args={['#031220']} />
              <fog attach="fog" args={['#031220', 10, 24]} />
              <GlobeScene />
            </Canvas>
          </div>
        ) : null}
      </div>

      <IndicatrixMetrics
        pane="globe"
        source={selectionSource}
        metrics={indicatrix?.metrics ?? null}
        message={
          selectionSource === 'map' && !inversePatch
            ? 'The inverse patch expands too much to draw cleanly on the current globe view.'
            : undefined
        }
      />
    </section>
  )
}
