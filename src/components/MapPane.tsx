import {
  useEffect,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { Vector2 } from 'three'
import { IndicatrixMetrics } from './IndicatrixMetrics'
import { buildMapScene, pickGeoPointFromScene, type MapScene } from '../lib/mapScene'
import {
  getEarthTextureCanvas,
  useEarthTextureVersion,
  type EarthTextureRequest,
} from '../lib/earthTexture'
import {
  sampleGeodesicArc,
  sampleScreenLine,
  splitProjectedGeoPath,
} from '../lib/geodesic'
import {
  analyzeIndicatrixAtPoint,
  sampleGeodesicCircleBoundary,
  sampleMapIndicatrixBoundary,
} from '../lib/indicatrix'
import { createMapBasemapRenderer, type MapBasemapRenderer } from '../lib/mapWebGlRenderer'
import type { GeodesicSelection, ProjectionDefinition, Size } from '../lib/types'
import { useAppStore } from '../lib/store'
import { useElementSize } from '../lib/useElementSize'

type OverlayShape = {
  center: Vector2
  boundary: Vector2[]
}

type OverlayPath = {
  endpoints: Vector2[]
  segments: Vector2[][]
}

type OverlayContent = {
  shape: OverlayShape | null
  path: OverlayPath | null
}

type PointerLikeEvent = {
  currentTarget: HTMLDivElement
  clientX: number
  clientY: number
}

const MAP_FRAME_MASK_STROKE = 'rgba(23, 50, 74, 0.98)'
const MAP_FRAME_EDGE_STROKE = 'rgba(220, 232, 239, 0.22)'
const MAP_GRATICULE_STROKE = 'rgba(220, 232, 239, 0.36)'
const PROJECTED_CURVE_MAX_JUMP_FACTOR = 0.32

function traceFrameOutline(
  context: CanvasRenderingContext2D,
  outline: Vector2[] | null,
) {
  if (!outline || outline.length < 3) {
    return false
  }

  context.beginPath()
  context.moveTo(outline[0].x, outline[0].y)

  for (let index = 1; index < outline.length; index += 1) {
    context.lineTo(outline[index].x, outline[index].y)
  }

  context.closePath()

  return true
}

function drawFrameEdge(
  context: CanvasRenderingContext2D,
  outline: Vector2[] | null,
) {
  if (!traceFrameOutline(context, outline)) {
    return
  }

  context.save()
  context.lineJoin = 'round'
  context.lineCap = 'round'
  context.strokeStyle = MAP_FRAME_MASK_STROKE
  context.lineWidth = 22
  context.stroke()

  traceFrameOutline(context, outline)
  context.strokeStyle = MAP_FRAME_EDGE_STROKE
  context.lineWidth = 1.1
  context.stroke()
  context.restore()
}

function prepareCanvas(canvas: HTMLCanvasElement, size: Size) {
  const dpr = window.devicePixelRatio || 1
  const width = Math.max(1, Math.floor(size.width * dpr))
  const height = Math.max(1, Math.floor(size.height * dpr))

  if (canvas.width !== width) {
    canvas.width = width
  }

  if (canvas.height !== height) {
    canvas.height = height
  }

  const cssWidth = `${size.width}px`
  const cssHeight = `${size.height}px`

  if (canvas.style.width !== cssWidth) {
    canvas.style.width = cssWidth
  }

  if (canvas.style.height !== cssHeight) {
    canvas.style.height = cssHeight
  }

  const context = canvas.getContext('2d')

  if (!context) {
    return null
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, size.width, size.height)

  return context
}

function drawBasemapFallback(
  scene: MapScene,
  context: CanvasRenderingContext2D,
  size: Size,
  visible: boolean,
  textureRequest: EarthTextureRequest,
) {
  context.clearRect(0, 0, size.width, size.height)

  if (!visible) {
    return
  }

  const texture = getEarthTextureCanvas(textureRequest)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  const clippedToFrame = traceFrameOutline(context, scene.frameOutline)

  if (clippedToFrame) {
    context.save()
    context.clip()
  }

  for (const triangle of scene.triangles) {
    const sourcePoints = triangle.texturePoints.map(
      (point) => new Vector2(point.x * texture.width, point.y * texture.height),
    ) as [Vector2, Vector2, Vector2]
    const denominator =
      sourcePoints[0].x * (sourcePoints[1].y - sourcePoints[2].y) +
      sourcePoints[1].x * (sourcePoints[2].y - sourcePoints[0].y) +
      sourcePoints[2].x * (sourcePoints[0].y - sourcePoints[1].y)

    if (Math.abs(denominator) < 1e-6) {
      continue
    }

    const transformA =
      (triangle.points[0].x * (sourcePoints[1].y - sourcePoints[2].y) +
        triangle.points[1].x * (sourcePoints[2].y - sourcePoints[0].y) +
        triangle.points[2].x * (sourcePoints[0].y - sourcePoints[1].y)) /
      denominator
    const transformB =
      (triangle.points[0].y * (sourcePoints[1].y - sourcePoints[2].y) +
        triangle.points[1].y * (sourcePoints[2].y - sourcePoints[0].y) +
        triangle.points[2].y * (sourcePoints[0].y - sourcePoints[1].y)) /
      denominator
    const transformC =
      (triangle.points[0].x * (sourcePoints[2].x - sourcePoints[1].x) +
        triangle.points[1].x * (sourcePoints[0].x - sourcePoints[2].x) +
        triangle.points[2].x * (sourcePoints[1].x - sourcePoints[0].x)) /
      denominator
    const transformD =
      (triangle.points[0].y * (sourcePoints[2].x - sourcePoints[1].x) +
        triangle.points[1].y * (sourcePoints[0].x - sourcePoints[2].x) +
        triangle.points[2].y * (sourcePoints[1].x - sourcePoints[0].x)) /
      denominator
    const transformE =
      (triangle.points[0].x *
        (sourcePoints[1].x * sourcePoints[2].y - sourcePoints[2].x * sourcePoints[1].y) +
        triangle.points[1].x *
          (sourcePoints[2].x * sourcePoints[0].y - sourcePoints[0].x * sourcePoints[2].y) +
        triangle.points[2].x *
          (sourcePoints[0].x * sourcePoints[1].y - sourcePoints[1].x * sourcePoints[0].y)) /
      denominator
    const transformF =
      (triangle.points[0].y *
        (sourcePoints[1].x * sourcePoints[2].y - sourcePoints[2].x * sourcePoints[1].y) +
        triangle.points[1].y *
          (sourcePoints[2].x * sourcePoints[0].y - sourcePoints[0].x * sourcePoints[2].y) +
        triangle.points[2].y *
          (sourcePoints[0].x * sourcePoints[1].y - sourcePoints[1].x * sourcePoints[0].y)) /
      denominator

    context.save()
    context.beginPath()
    context.moveTo(triangle.points[0].x, triangle.points[0].y)
    context.lineTo(triangle.points[1].x, triangle.points[1].y)
    context.lineTo(triangle.points[2].x, triangle.points[2].y)
    context.closePath()
    context.clip()
    context.transform(
      transformA,
      transformB,
      transformC,
      transformD,
      transformE,
      transformF,
    )
    context.drawImage(texture, 0, 0)
    context.restore()
  }

  if (clippedToFrame) {
    context.restore()
  }
}

function drawGraticule(
  scene: MapScene,
  context: CanvasRenderingContext2D,
  size: Size,
  visible: boolean,
) {
  context.clearRect(0, 0, size.width, size.height)

  if (!visible) {
    return
  }

  context.strokeStyle = MAP_GRATICULE_STROKE
  context.lineWidth = 1
  const clippedToFrame = traceFrameOutline(context, scene.frameOutline)

  if (clippedToFrame) {
    context.save()
    context.clip()
  }

  for (const line of scene.graticuleLines) {
    context.beginPath()
    context.moveTo(line[0].x, line[0].y)

    for (let index = 1; index < line.length; index += 1) {
      context.lineTo(line[index].x, line[index].y)
    }

    context.stroke()
  }

  if (clippedToFrame) {
    context.restore()
  }
}

function drawCurveOverlay(
  context: CanvasRenderingContext2D,
  path: OverlayPath,
) {
  for (const segment of path.segments) {
    if (segment.length < 2) {
      continue
    }

    context.save()
    context.lineJoin = 'round'
    context.lineCap = 'round'
    context.shadowColor = 'rgba(0, 0, 0, 0.24)'
    context.shadowBlur = 10
    context.shadowOffsetY = 1.5
    context.strokeStyle = 'rgba(17, 9, 4, 0.62)'
    context.lineWidth = 5
    context.beginPath()
    context.moveTo(segment[0].x, segment[0].y)

    for (let index = 1; index < segment.length; index += 1) {
      context.lineTo(segment[index].x, segment[index].y)
    }

    context.stroke()
    context.shadowColor = 'transparent'
    context.shadowBlur = 0
    context.shadowOffsetY = 0
    context.strokeStyle = 'rgba(255, 186, 93, 0.96)'
    context.lineWidth = 2.35
    context.beginPath()
    context.moveTo(segment[0].x, segment[0].y)

    for (let index = 1; index < segment.length; index += 1) {
      context.lineTo(segment[index].x, segment[index].y)
    }

    context.stroke()
    context.strokeStyle = 'rgba(255, 245, 218, 0.95)'
    context.lineWidth = 1.05
    context.beginPath()
    context.moveTo(segment[0].x, segment[0].y)

    for (let index = 1; index < segment.length; index += 1) {
      context.lineTo(segment[index].x, segment[index].y)
    }

    context.stroke()
    context.restore()
  }

  for (const point of path.endpoints) {
    context.save()
    context.fillStyle = 'rgba(255, 248, 216, 0.96)'
    context.shadowColor = 'rgba(255, 191, 105, 0.7)'
    context.shadowBlur = 10
    context.beginPath()
    context.arc(point.x, point.y, 4.5, 0, Math.PI * 2)
    context.fill()
    context.shadowColor = 'transparent'
    context.shadowBlur = 0
    context.strokeStyle = 'rgba(32, 17, 8, 0.92)'
    context.lineWidth = 1.35
    context.beginPath()
    context.arc(point.x, point.y, 4.5, 0, Math.PI * 2)
    context.stroke()
    context.restore()
  }
}

function buildMapGeodesicOverlay(
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

  if (geodesicSelection.source === 'map') {
    if (endpoints.length < 2) {
      return endpoints.length > 0
        ? {
            endpoints,
            segments: [],
          }
        : null
    }

    return {
      endpoints,
      segments: [sampleScreenLine(endpoints[0], endpoints[1])],
    }
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

function drawOverlay(
  context: CanvasRenderingContext2D,
  size: Size,
  scene: MapScene,
  overlay: OverlayContent,
) {
  context.clearRect(0, 0, size.width, size.height)

  const clippedToFrame = traceFrameOutline(context, scene.frameOutline)

  if (clippedToFrame) {
    context.save()
    context.clip()
  }

  if (overlay.shape && overlay.shape.boundary.length >= 3) {
    const { shape } = overlay
    const radius = shape.boundary.reduce((maxRadius, point) => {
      return Math.max(
        maxRadius,
        Math.hypot(point.x - shape.center.x, point.y - shape.center.y),
      )
    }, 0)
    const centerDotRadius = Math.max(2.1, Math.min(3.4, radius * 0.12))
    const markerGradient = context.createRadialGradient(
      shape.center.x - radius * 0.34,
      shape.center.y - radius * 0.42,
      Math.max(1.2, radius * 0.14),
      shape.center.x,
      shape.center.y,
      Math.max(8, radius * 1.08),
    )
    markerGradient.addColorStop(0, 'rgba(255, 248, 216, 0.76)')
    markerGradient.addColorStop(0.55, 'rgba(255, 213, 138, 0.34)')
    markerGradient.addColorStop(1, 'rgba(255, 157, 78, 0.12)')

    context.fillStyle = markerGradient
    context.shadowColor = 'rgba(0, 0, 0, 0.2)'
    context.shadowBlur = Math.max(4, radius * 0.32)
    context.shadowOffsetY = Math.max(1, radius * 0.06)
    context.beginPath()
    context.moveTo(shape.boundary[0].x, shape.boundary[0].y)

    for (let index = 1; index < shape.boundary.length; index += 1) {
      context.lineTo(shape.boundary[index].x, shape.boundary[index].y)
    }

    context.closePath()
    context.fill()
    context.shadowColor = 'transparent'
    context.shadowBlur = 0
    context.shadowOffsetY = 0

    context.fillStyle = 'rgba(255, 248, 216, 0.92)'
    context.beginPath()
    context.arc(
      shape.center.x - centerDotRadius * 0.35,
      shape.center.y - centerDotRadius * 0.42,
      centerDotRadius,
      0,
      Math.PI * 2,
    )
    context.fill()

    context.strokeStyle = 'rgba(17, 9, 4, 0.62)'
    context.lineWidth = 4.2
    context.beginPath()
    context.moveTo(shape.boundary[0].x, shape.boundary[0].y)

    for (let index = 1; index < shape.boundary.length; index += 1) {
      context.lineTo(shape.boundary[index].x, shape.boundary[index].y)
    }

    context.closePath()
    context.stroke()

    context.strokeStyle = 'rgba(32, 17, 8, 0.92)'
    context.lineWidth = 2.2
    context.beginPath()
    context.moveTo(shape.boundary[0].x, shape.boundary[0].y)

    for (let index = 1; index < shape.boundary.length; index += 1) {
      context.lineTo(shape.boundary[index].x, shape.boundary[index].y)
    }

    context.closePath()
    context.stroke()

    context.strokeStyle = 'rgba(255, 245, 218, 0.95)'
    context.lineWidth = 1.15
    context.beginPath()
    context.moveTo(shape.boundary[0].x, shape.boundary[0].y)

    for (let index = 1; index < shape.boundary.length; index += 1) {
      context.lineTo(shape.boundary[index].x, shape.boundary[index].y)
    }

    context.closePath()
    context.stroke()
  }

  if (overlay.path) {
    drawCurveOverlay(context, overlay.path)
  }

  if (clippedToFrame) {
    context.restore()
  }

  if (!scene.frameOutline) {
    return
  }

  drawFrameEdge(context, scene.frameOutline)
}

export function MapPane({ projection }: { projection: ProjectionDefinition }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const basemapCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const graticuleCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const basemapRendererRef = useRef<MapBasemapRenderer | null | undefined>(undefined)
  const sceneRef = useRef<MapScene | null>(null)
  const textureVersion = useEarthTextureVersion()
  const globeOrientation = useAppStore((state) => state.globeOrientation)
  const projectionFrame = useAppStore((state) => state.projectionFrame)
  const selection = useAppStore((state) => state.selection)
  const selectionSource = useAppStore((state) => state.selectionSource)
  const geodesicSelection = useAppStore((state) => state.geodesicSelection)
  const activeTool = useAppStore((state) => state.activeTool)
  const showDayNight = useAppStore((state) => state.showDayNight)
  const dayNightTimestampMs = useAppStore((state) => state.dayNightTimestampMs)
  const setSelection = useAppStore((state) => state.setSelection)
  const pushGeodesicPoint = useAppStore((state) => state.pushGeodesicPoint)
  const clearGeodesicSelection = useAppStore(
    (state) => state.clearGeodesicSelection,
  )
  const size = useElementSize(containerRef)
  const indicatrix = useMemo(() => {
    if (!selection || !selectionSource) {
      return null
    }

    return analyzeIndicatrixAtPoint(
      projection,
      projectionFrame,
      globeOrientation,
      selection,
    )
  }, [globeOrientation, projection, projectionFrame, selection, selectionSource])
  const textureRequest = useMemo(
    () => ({
      showDayNight,
      timestampMs: dayNightTimestampMs,
    }),
    [dayNightTimestampMs, showDayNight],
  )

  useEffect(() => {
    return () => {
      basemapRendererRef.current?.dispose()
      basemapRendererRef.current = undefined
    }
  }, [])

  useEffect(() => {
    if (
      size.width <= 0 ||
      size.height <= 0 ||
      !graticuleCanvasRef.current ||
      !overlayCanvasRef.current
    ) {
      return
    }

    const basemapCanvas = basemapCanvasRef.current
    const basemapRenderer =
      basemapRendererRef.current === undefined && basemapCanvas
        ? (basemapRendererRef.current = createMapBasemapRenderer(basemapCanvas))
        : basemapRendererRef.current
    const basemapContext =
      !basemapRenderer && basemapCanvas
        ? prepareCanvas(basemapCanvas, size)
        : null
    const graticuleContext = prepareCanvas(graticuleCanvasRef.current, size)
    const overlayContext = prepareCanvas(overlayCanvasRef.current, size)

    if (!graticuleContext || !overlayContext) {
      return
    }

    const scene = buildMapScene(
      projection,
      projectionFrame,
      globeOrientation,
      size,
    )
    const directProjectedShape =
      selection && selectionSource === 'globe'
        ? (() => {
            const center = scene.projectGeoToScreen(selection)

            if (!center) {
              return null
            }

            const boundary = sampleGeodesicCircleBoundary(selection).map((point) =>
              scene.projectGeoToScreen(point),
            )

            if (boundary.some((point) => point === null)) {
              return null
            }

            return {
              center,
              boundary: boundary.filter((point): point is Vector2 => point !== null),
            } satisfies OverlayShape
          })()
        : null
    const overlayShape =
      directProjectedShape ??
      (selection && selectionSource && indicatrix
        ? {
            center: scene.rawToScreen(indicatrix.centerRaw),
            boundary: sampleMapIndicatrixBoundary(indicatrix, selectionSource).map(
              (point) => scene.rawToScreen(point),
            ),
          }
        : null)
    const geodesicOverlay = buildMapGeodesicOverlay(
      scene,
      size,
      geodesicSelection,
    )

    sceneRef.current = scene

    if (basemapRenderer) {
      basemapRenderer.render(
        scene,
        size,
        true,
        textureRequest,
        textureVersion,
      )
    } else if (basemapContext) {
      drawBasemapFallback(scene, basemapContext, size, true, textureRequest)
    }
    drawGraticule(scene, graticuleContext, size, true)
    drawOverlay(overlayContext, size, scene, {
      shape: overlayShape,
      path: geodesicOverlay,
    })
  }, [
    geodesicSelection,
    indicatrix,
    globeOrientation,
    projection,
    projectionFrame,
    selection,
    selectionSource,
    showDayNight,
    size,
    textureRequest,
    textureVersion,
  ])

  function getPointerCoordinates(event: PointerLikeEvent) {
    const bounds = event.currentTarget.getBoundingClientRect()

    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    }
  }

  function handleClick(event: ReactMouseEvent<HTMLDivElement>) {
    if ((activeTool !== 'select' && activeTool !== 'geodesic') || !sceneRef.current) {
      return
    }

    const pointer = getPointerCoordinates(event)
    const point = pickGeoPointFromScene(sceneRef.current, pointer.x, pointer.y)

    if (point) {
      if (activeTool === 'select') {
        setSelection(point, 'map')
      } else {
        pushGeodesicPoint(point, 'map')
      }
      return
    }

    if (activeTool === 'select') {
      setSelection(null)
    } else {
      clearGeodesicSelection()
    }
  }

  return (
    <section className="pane pane-map">
      <div className="pane-label">
        <span className="pane-title">Projected map</span>
        <span className="pane-subtitle">{projection.label}</span>
      </div>

      <div
        ref={containerRef}
        className="map-canvas-stack"
        onClick={handleClick}
      >
        <canvas ref={basemapCanvasRef} className="map-layer" />
        <canvas ref={graticuleCanvasRef} className="map-layer" />
        <canvas ref={overlayCanvasRef} className="map-layer map-layer-overlay" />
      </div>

      <IndicatrixMetrics
        pane="map"
        source={selectionSource}
        metrics={indicatrix?.metrics ?? null}
        message={
          selectionSource === 'globe' && !indicatrix
            ? 'The selected globe circle is clipped by the current projection frame.'
            : undefined
        }
      />
    </section>
  )
}
