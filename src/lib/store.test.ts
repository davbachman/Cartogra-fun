import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from './store'

describe('app store behavior', () => {
  beforeEach(() => {
    useAppStore.getState().resetStore()
  })

  it('keeps view rotation separate from projection rotation state', () => {
    const initial = useAppStore.getState()

    useAppStore.getState().nudgeViewCamera(12, -6)

    const afterViewRotate = useAppStore.getState()

    expect(afterViewRotate.viewCamera.azimuthDeg).not.toBe(initial.viewCamera.azimuthDeg)
    expect(afterViewRotate.viewCamera.elevationDeg).not.toBe(initial.viewCamera.elevationDeg)
    expect(afterViewRotate.globeOrientation).toEqual(initial.globeOrientation)
    expect(afterViewRotate.projectionFrame).toEqual(initial.projectionFrame)

    useAppStore.getState().nudgeGlobeOrientation(18, 9)

    const afterProjectionRotate = useAppStore.getState()

    expect(afterProjectionRotate.globeOrientation.azimuthDeg).toBe(18)
    expect(afterProjectionRotate.globeOrientation.elevationDeg).toBe(9)
    expect(afterProjectionRotate.globeOrientation.rollDeg).toBe(0)
    expect(afterProjectionRotate.projectionFrame).toEqual(initial.projectionFrame)
    expect(afterProjectionRotate.viewCamera).toEqual(afterViewRotate.viewCamera)
  })

  it('toggles projection visualization independently from the map state', () => {
    expect(useAppStore.getState().showProjectionVisualization).toBe(false)

    useAppStore.getState().toggleProjectionVisualization()

    expect(useAppStore.getState().showProjectionVisualization).toBe(true)
  })

  it('toggles fix projection independently from the active tool', () => {
    useAppStore.getState().setActiveTool('geodesic')

    expect(useAppStore.getState().fixProjection).toBe(false)

    useAppStore.getState().toggleFixProjection()

    expect(useAppStore.getState().fixProjection).toBe(true)
    expect(useAppStore.getState().activeTool).toBe('geodesic')

    useAppStore.getState().toggleFixProjection()

    expect(useAppStore.getState().fixProjection).toBe(false)
    expect(useAppStore.getState().activeTool).toBe('geodesic')
  })

  it('resets the globe pose and projection frame back to the startup state', () => {
    useAppStore.getState().setActiveProjection('orthographic')
    useAppStore.getState().nudgeViewCamera(20, 12)
    useAppStore.getState().nudgeGlobeOrientation(30, -10)
    useAppStore.getState().nudgeProjectionFrame(15, 8)
    useAppStore.getState().setSelection({ latDeg: 12, lonDeg: -38 }, 'map')

    useAppStore.getState().resetGlobePose()

    const state = useAppStore.getState()

    expect(state.viewCamera).toEqual({
      azimuthDeg: 0,
      elevationDeg: -18,
      distance: 3.15,
    })
    expect(state.globeOrientation).toEqual({
      azimuthDeg: 0,
      elevationDeg: 0,
      rollDeg: 0,
    })
    expect(state.activeProjectionId).toBe('orthographic')
    expect(state.projectionFrame).toEqual({
      centralLonDeg: 0,
      centerLatDeg: 0,
    })
  })

  it('tracks which pane produced the active selection', () => {
    useAppStore.getState().setSelection({ latDeg: 24, lonDeg: -12 }, 'globe')

    expect(useAppStore.getState().selectionSource).toBe('globe')

    useAppStore.getState().setSelection({ latDeg: -8, lonDeg: 47 }, 'map')

    expect(useAppStore.getState().selectionSource).toBe('map')

    useAppStore.getState().setSelection(null)

    expect(useAppStore.getState().selection).toBeNull()
    expect(useAppStore.getState().selectionSource).toBeNull()
  })

  it('tracks geodesic endpoints independently from point selection', () => {
    useAppStore.getState().setSelection({ latDeg: 24, lonDeg: -12 }, 'globe')
    useAppStore.getState().pushGeodesicPoint({ latDeg: 10, lonDeg: 20 }, 'globe')

    expect(useAppStore.getState().selection).toBeNull()
    expect(useAppStore.getState().selectionSource).toBeNull()
    expect(useAppStore.getState().geodesicSelection).toEqual({
      source: 'globe',
      points: [{ latDeg: 10, lonDeg: 20 }],
    })

    useAppStore.getState().pushGeodesicPoint({ latDeg: -6, lonDeg: 42 }, 'globe')

    expect(useAppStore.getState().geodesicSelection).toEqual({
      source: 'globe',
      points: [
        { latDeg: 10, lonDeg: 20 },
        { latDeg: -6, lonDeg: 42 },
      ],
    })

    useAppStore.getState().pushGeodesicPoint({ latDeg: 4, lonDeg: -18 }, 'map')

    expect(useAppStore.getState().geodesicSelection).toEqual({
      source: 'map',
      points: [{ latDeg: 4, lonDeg: -18 }],
    })
  })

  it('keeps manual day/night time separate from the live clock mode', () => {
    vi.useFakeTimers()

    try {
      const initialManualTimestampMs = Date.UTC(2026, 2, 27, 9, 30, 0)

      useAppStore.getState().setDayNightManualTimestamp(initialManualTimestampMs)
      useAppStore.getState().toggleDayNight()
      useAppStore
        .getState()
        .setDayNightFollowNow(true, Date.UTC(2026, 2, 27, 10, 0, 0))

      expect(useAppStore.getState().dayNightManualTimestampMs).toBe(
        initialManualTimestampMs,
      )
      expect(useAppStore.getState().dayNightTimestampMs).toBe(
        Date.UTC(2026, 2, 27, 10, 0, 0),
      )

      useAppStore
        .getState()
        .tickDayNightClock(Date.UTC(2026, 2, 27, 10, 5, 0))

      expect(useAppStore.getState().dayNightTimestampMs).toBe(
        Date.UTC(2026, 2, 27, 10, 5, 0),
      )

      useAppStore.getState().setDayNightFollowNow(false)

      expect(useAppStore.getState().dayNightTimestampMs).toBe(
        initialManualTimestampMs,
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
