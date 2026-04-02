import { fireEvent, render, waitFor } from '@testing-library/react'
import { Vector2 } from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MapPane } from './MapPane'
import { buildMapGeodesicOverlay } from '../lib/mapGeodesicOverlay'
import { getProjectionDefinition } from '../lib/projections'
import { useAppStore } from '../lib/store'

const {
  buildMapSceneMock,
  pickGeoPointFromSceneMock,
  mockScene,
} = vi.hoisted(() => {
  const mockScene = {
    triangles: [],
    graticuleLines: [],
    frameOutline: [
      { x: 32, y: 32 },
      { x: 224, y: 32 },
      { x: 224, y: 160 },
      { x: 32, y: 160 },
    ],
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    projectGeoToScreen: vi.fn(() => new Vector2(128, 96)),
    rawToScreen: vi.fn((point: { x: number; y: number }) => new Vector2(point.x, point.y)),
  }

  return {
    buildMapSceneMock: vi.fn(() => mockScene),
    pickGeoPointFromSceneMock: vi.fn(),
    mockScene,
  }
})

vi.mock('../lib/mapScene', () => ({
  buildMapScene: buildMapSceneMock,
  pickGeoPointFromScene: pickGeoPointFromSceneMock,
}))

vi.mock('../lib/useElementSize', () => ({
  useElementSize: () => ({ width: 960, height: 640 }),
}))

vi.mock('../lib/earthTexture', () => ({
  getEarthTextureCanvas: () => document.createElement('canvas'),
  useEarthTextureVersion: () => 0,
}))

describe('MapPane selection behavior', () => {
  beforeEach(() => {
    useAppStore.getState().resetStore()
    useAppStore.getState().setActiveTool('select')
    buildMapSceneMock.mockClear()
    pickGeoPointFromSceneMock.mockReset()
    mockScene.projectGeoToScreen.mockClear()
    mockScene.rawToScreen.mockClear()
  })

  it('clears the current selection when the user clicks off the projected map', async () => {
    useAppStore.getState().setSelection({ latDeg: 14, lonDeg: 22 }, 'globe')
    pickGeoPointFromSceneMock.mockReturnValue(null)

    const { container } = render(
      <MapPane projection={getProjectionDefinition('mercator')} />,
    )

    await waitFor(() => {
      expect(buildMapSceneMock).toHaveBeenCalled()
    })

    const mapStack = container.querySelector('.map-canvas-stack')

    expect(mapStack).not.toBeNull()

    fireEvent.click(mapStack!, { clientX: 40, clientY: 52 })

    expect(useAppStore.getState().selection).toBeNull()
    expect(useAppStore.getState().selectionSource).toBeNull()
  })

  it('stores a newly picked point when the user clicks on the projected map', async () => {
    pickGeoPointFromSceneMock.mockReturnValue({ latDeg: -8, lonDeg: 133 })

    const { container } = render(
      <MapPane projection={getProjectionDefinition('mercator')} />,
    )

    await waitFor(() => {
      expect(buildMapSceneMock).toHaveBeenCalled()
    })

    const mapStack = container.querySelector('.map-canvas-stack')

    fireEvent.click(mapStack!, { clientX: 120, clientY: 84 })

    expect(useAppStore.getState().selection).toEqual({ latDeg: -8, lonDeg: 133 })
    expect(useAppStore.getState().selectionSource).toBe('map')
  })

  it('builds a two-point map-line selection in geodesic mode', async () => {
    useAppStore.getState().setActiveTool('geodesic')
    pickGeoPointFromSceneMock
      .mockReturnValueOnce({ latDeg: -8, lonDeg: 133 })
      .mockReturnValueOnce({ latDeg: 16, lonDeg: -42 })

    const { container } = render(
      <MapPane projection={getProjectionDefinition('mercator')} />,
    )

    await waitFor(() => {
      expect(buildMapSceneMock).toHaveBeenCalled()
    })

    const mapStack = container.querySelector('.map-canvas-stack')

    fireEvent.click(mapStack!, { clientX: 120, clientY: 84 })
    fireEvent.click(mapStack!, { clientX: 164, clientY: 140 })

    expect(useAppStore.getState().selection).toBeNull()
    expect(useAppStore.getState().geodesicSelection).toEqual({
      source: 'map',
      points: [
        { latDeg: -8, lonDeg: 133 },
        { latDeg: 16, lonDeg: -42 },
      ],
    })
  })

  it('projects the globe geodesic for map-picked endpoints', () => {
    const start = { latDeg: 0, lonDeg: -20 }
    const end = { latDeg: 60, lonDeg: 20 }
    const projectGeoToScreen = vi.fn(
      (point: { latDeg: number; lonDeg: number }) =>
        new Vector2(point.lonDeg * 4, point.latDeg * 4),
    )
    const scene = {
      projectGeoToScreen,
    } as unknown as Parameters<typeof buildMapGeodesicOverlay>[0]

    const overlay = buildMapGeodesicOverlay(
      scene,
      { width: 960, height: 640 },
      {
        source: 'map',
        points: [start, end],
      },
    )

    expect(overlay).not.toBeNull()
    expect(projectGeoToScreen.mock.calls.length).toBeGreaterThan(2)
    expect(overlay?.segments).toHaveLength(1)

    const midpoint = overlay!.segments[0][Math.floor(overlay!.segments[0].length / 2)]
    const straightMidpoint = new Vector2().lerpVectors(
      overlay!.endpoints[0],
      overlay!.endpoints[1],
      0.5,
    )

    expect(midpoint.distanceTo(straightMidpoint)).toBeGreaterThan(5)
  })

  it('clears the current geodesic selection when the user clicks off the projected map', async () => {
    useAppStore.getState().setActiveTool('geodesic')
    useAppStore.getState().pushGeodesicPoint({ latDeg: 14, lonDeg: 22 }, 'map')
    pickGeoPointFromSceneMock.mockReturnValue(null)

    const { container } = render(
      <MapPane projection={getProjectionDefinition('mercator')} />,
    )

    await waitFor(() => {
      expect(buildMapSceneMock).toHaveBeenCalled()
    })

    const mapStack = container.querySelector('.map-canvas-stack')

    fireEvent.click(mapStack!, { clientX: 40, clientY: 52 })

    expect(useAppStore.getState().geodesicSelection).toBeNull()
  })

  it('does not pan the projected map on drag gestures', async () => {
    const { container } = render(
      <MapPane projection={getProjectionDefinition('mercator')} />,
    )

    await waitFor(() => {
      expect(buildMapSceneMock).toHaveBeenCalledTimes(1)
    })

    buildMapSceneMock.mockClear()

    const mapStack = container.querySelector('.map-canvas-stack') as HTMLDivElement

    fireEvent.pointerDown(mapStack, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(mapStack, { pointerId: 1, clientX: 110, clientY: 105 })
    fireEvent.pointerMove(mapStack, { pointerId: 1, clientX: 120, clientY: 110 })
    fireEvent.pointerUp(mapStack, { pointerId: 1, clientX: 120, clientY: 110 })

    expect(buildMapSceneMock).not.toHaveBeenCalled()
    expect(useAppStore.getState().projectionFrame).toEqual({
      centralLonDeg: 0,
      centerLatDeg: 0,
    })
  })
})
