import { create } from 'zustand'
import { clamp, clampLatitudeDeg, wrapLongitudeDeg } from './math'
import type {
  ActiveTool,
  AppState,
  GeoPoint,
  GlobeOrientation,
  SelectionSource,
} from './types'

interface AppActions {
  setActiveTool: (tool: ActiveTool) => void
  toggleFixProjection: () => void
  setActiveProjection: (projectionId: string) => void
  setProjectionFrame: (frame: AppState['projectionFrame']) => void
  setSelection: (point: GeoPoint | null, source?: SelectionSource | null) => void
  pushGeodesicPoint: (point: GeoPoint, source: SelectionSource) => void
  clearGeodesicSelection: () => void
  resetGlobePose: () => void
  nudgeViewCamera: (deltaAzimuthDeg: number, deltaElevationDeg: number) => void
  setGlobeOrientation: (orientation: GlobeOrientation) => void
  nudgeGlobeOrientation: (
    deltaAzimuthDeg: number,
    deltaElevationDeg: number,
  ) => void
  nudgeProjectionFrame: (deltaLonDeg: number, deltaLatDeg: number) => void
  toggleProjectionVisualization: () => void
  toggleDayNight: () => void
  setDayNightManualTimestamp: (timestampMs: number) => void
  setDayNightFollowNow: (followNow: boolean, nowMs?: number) => void
  tickDayNightClock: (nowMs?: number) => void
  resetStore: () => void
}

const initialViewCamera = {
  azimuthDeg: 0,
  elevationDeg: -18,
  distance: 3.15,
}

const initialGlobeOrientation = {
  azimuthDeg: 0,
  elevationDeg: 0,
  rollDeg: 0,
}

const initialProjectionFrame = {
  centralLonDeg: 0,
  centerLatDeg: 0,
}

function createInitialState(nowMs = Date.now()): AppState {
  return {
    activeTool: 'select',
    fixProjection: false,
    activeProjectionId: 'mercator',
    viewCamera: { ...initialViewCamera },
    globeOrientation: { ...initialGlobeOrientation },
    projectionFrame: { ...initialProjectionFrame },
    selection: null,
    selectionSource: null,
    geodesicSelection: null,
    showProjectionVisualization: false,
    showDayNight: false,
    dayNightFollowNow: false,
    dayNightManualTimestampMs: nowMs,
    dayNightTimestampMs: nowMs,
  }
}

export const useAppStore = create<AppState & AppActions>((set) => ({
  ...createInitialState(),
  setActiveTool(activeTool) {
    set({ activeTool })
  },
  toggleFixProjection() {
    set((state) => ({ fixProjection: !state.fixProjection }))
  },
  setActiveProjection(activeProjectionId) {
    set({ activeProjectionId })
  },
  setProjectionFrame(projectionFrame) {
    set({
      projectionFrame: {
        centralLonDeg: wrapLongitudeDeg(projectionFrame.centralLonDeg),
        centerLatDeg: clampLatitudeDeg(projectionFrame.centerLatDeg),
      },
    })
  },
  setSelection(selection, selectionSource = null) {
    set((state) => ({
      selection,
      selectionSource: selection ? selectionSource : null,
      geodesicSelection: selection ? null : state.geodesicSelection,
    }))
  },
  pushGeodesicPoint(point, source) {
    set((state) => {
      const currentSelection = state.geodesicSelection
      const shouldStartNewSelection =
        !currentSelection ||
        currentSelection.source !== source ||
        currentSelection.points.length >= 2

      return {
        selection: null,
        selectionSource: null,
        geodesicSelection: shouldStartNewSelection
          ? {
              source,
              points: [point],
            }
          : {
              source,
              points: [...currentSelection.points, point],
            },
      }
    })
  },
  clearGeodesicSelection() {
    set({ geodesicSelection: null })
  },
  resetGlobePose() {
    set({
      viewCamera: { ...initialViewCamera },
      globeOrientation: { ...initialGlobeOrientation },
      projectionFrame: { ...initialProjectionFrame },
    })
  },
  nudgeViewCamera(deltaAzimuthDeg, deltaElevationDeg) {
    set((state) => ({
      viewCamera: {
        ...state.viewCamera,
        azimuthDeg: wrapLongitudeDeg(state.viewCamera.azimuthDeg + deltaAzimuthDeg),
        elevationDeg: clamp(
          state.viewCamera.elevationDeg + deltaElevationDeg,
          -75,
          75,
        ),
      },
    }))
  },
  setGlobeOrientation(orientation) {
    set({
      globeOrientation: normalizeOrientation(orientation),
    })
  },
  nudgeGlobeOrientation(deltaAzimuthDeg, deltaElevationDeg) {
    set((state) => ({
      globeOrientation: normalizeOrientation({
        azimuthDeg: state.globeOrientation.azimuthDeg + deltaAzimuthDeg,
        elevationDeg: state.globeOrientation.elevationDeg + deltaElevationDeg,
        rollDeg: state.globeOrientation.rollDeg ?? 0,
      }),
    }))
  },
  nudgeProjectionFrame(deltaLonDeg, deltaLatDeg) {
    set((state) => ({
      projectionFrame: {
        centralLonDeg: wrapLongitudeDeg(
          state.projectionFrame.centralLonDeg + deltaLonDeg,
        ),
        centerLatDeg: clampLatitudeDeg(
          state.projectionFrame.centerLatDeg + deltaLatDeg,
        ),
      },
    }))
  },
  toggleProjectionVisualization() {
    set((state) => ({
      showProjectionVisualization: !state.showProjectionVisualization,
    }))
  },
  toggleDayNight() {
    set((state) => ({
      showDayNight: !state.showDayNight,
      dayNightTimestampMs:
        !state.showDayNight && state.dayNightFollowNow
          ? Date.now()
          : state.dayNightTimestampMs,
    }))
  },
  setDayNightManualTimestamp(timestampMs) {
    if (!Number.isFinite(timestampMs)) {
      return
    }

    set((state) => ({
      dayNightManualTimestampMs: timestampMs,
      dayNightTimestampMs: state.dayNightFollowNow
        ? state.dayNightTimestampMs
        : timestampMs,
    }))
  },
  setDayNightFollowNow(followNow, nowMs = Date.now()) {
    set((state) => ({
      dayNightFollowNow: followNow,
      dayNightTimestampMs: followNow ? nowMs : state.dayNightManualTimestampMs,
    }))
  },
  tickDayNightClock(nowMs = Date.now()) {
    set((state) => {
      if (!state.showDayNight || !state.dayNightFollowNow) {
        return state
      }

      return { dayNightTimestampMs: nowMs }
    })
  },
  resetStore() {
    set(createInitialState())
  },
}))

function normalizeOrientation(orientation: GlobeOrientation) {
  return {
    azimuthDeg: wrapLongitudeDeg(orientation.azimuthDeg),
    elevationDeg: clamp(orientation.elevationDeg, -75, 75),
    rollDeg: wrapLongitudeDeg(orientation.rollDeg ?? 0),
  }
}
