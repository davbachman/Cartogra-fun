export type ProjectionFamily =
  | 'Cylindrical'
  | 'Conic'
  | 'Azimuthal'

export type VisualizationSurface =
  | 'plane'
  | 'cylinder'
  | 'cone'
  | 'unsupported'

export type ProjectionVisualizationMode =
  | 'point-source'
  | 'line-source'
  | 'parallel-rays'
  | 'surface-only'
  | 'unsupported'

export type ProjectionClipPolicy = 'wrap' | 'radial'

export type ActiveTool = 'select' | 'geodesic'
export type SelectionSource = 'globe' | 'map'

export interface GeoPoint {
  latDeg: number
  lonDeg: number
}

export interface GeodesicSelection {
  source: SelectionSource
  points: GeoPoint[]
}

export interface ViewCamera {
  azimuthDeg: number
  elevationDeg: number
  distance: number
}

export interface GlobeOrientation {
  azimuthDeg: number
  elevationDeg: number
  rollDeg?: number
}

export interface ProjectionFrame {
  centralLonDeg: number
  centerLatDeg: number
}

export interface ProjectionParameters {
  standardParallel1Deg?: number
  standardParallel2Deg?: number
  clipLatitudeDeg?: number
}

export interface ForwardProjectionResult {
  x: number
  y: number
  visible: boolean
  seamCoord?: number
  regionId?: string
}

export interface ProjectionDefinition {
  id: string
  label: string
  family: ProjectionFamily
  clipPolicy: ProjectionClipPolicy
  defaults: ProjectionParameters
  visualizationSurface: VisualizationSurface
  visualizationMode: ProjectionVisualizationMode
  forward: (
    point: GeoPoint,
    frame: ProjectionFrame,
    params: ProjectionParameters,
  ) => ForwardProjectionResult
}

export interface AppState {
  activeTool: ActiveTool
  fixProjection: boolean
  activeProjectionId: string
  viewCamera: ViewCamera
  globeOrientation: GlobeOrientation
  projectionFrame: ProjectionFrame
  selection: GeoPoint | null
  selectionSource: SelectionSource | null
  geodesicSelection: GeodesicSelection | null
  showProjectionVisualization: boolean
  showDayNight: boolean
  dayNightFollowNow: boolean
  dayNightManualTimestampMs: number
  dayNightTimestampMs: number
}

export interface Size {
  width: number
  height: number
}
