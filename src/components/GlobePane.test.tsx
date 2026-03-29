import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobePane } from './GlobePane'
import { useAppStore } from '../lib/store'

vi.mock('@react-three/fiber', () => ({
  Canvas: ({
    onPointerMissed,
  }: {
    children?: ReactNode
    onPointerMissed?: (event: MouseEvent) => void
  }) => (
    <button
      type="button"
      data-testid="globe-miss-target"
      onClick={() => onPointerMissed?.(new MouseEvent('click'))}
    >
      Mock globe
    </button>
  ),
}))

vi.mock('../lib/useElementSize', () => ({
  useElementSize: () => ({ width: 520, height: 520 }),
}))

describe('GlobePane selection behavior', () => {
  beforeEach(() => {
    useAppStore.getState().resetStore()
  })

  it('clears the current selection when the user clicks away from the globe in select mode', () => {
    useAppStore.getState().setActiveTool('select')
    useAppStore.getState().setSelection({ latDeg: 32, lonDeg: -18 }, 'map')

    render(<GlobePane />)
    fireEvent.click(screen.getByTestId('globe-miss-target'))

    expect(useAppStore.getState().selection).toBeNull()
    expect(useAppStore.getState().selectionSource).toBeNull()
  })

  it('does not clear selection on globe misses outside select mode', () => {
    useAppStore.getState().setActiveTool('geodesic')
    useAppStore.getState().setSelection({ latDeg: 32, lonDeg: -18 }, 'map')

    render(<GlobePane />)
    fireEvent.click(screen.getByTestId('globe-miss-target'))

    expect(useAppStore.getState().selection).toEqual({ latDeg: 32, lonDeg: -18 })
    expect(useAppStore.getState().selectionSource).toBe('map')
  })

  it('clears the current geodesic selection when the user clicks away in geodesic mode', () => {
    useAppStore.getState().setActiveTool('geodesic')
    useAppStore.getState().pushGeodesicPoint({ latDeg: 12, lonDeg: 20 }, 'globe')

    render(<GlobePane />)
    fireEvent.click(screen.getByTestId('globe-miss-target'))

    expect(useAppStore.getState().geodesicSelection).toBeNull()
  })

  it('uses secondary-button drag to rotate the 3D view when projection is not fixed', () => {
    const { container } = render(<GlobePane />)
    const globeStage = container.querySelector('.globe-stage') as HTMLDivElement
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()

    Object.assign(globeStage, { setPointerCapture, releasePointerCapture })

    fireEvent.pointerDown(globeStage, {
      button: 2,
      pointerId: 7,
      clientX: 100,
      clientY: 200,
    })
    fireEvent.pointerMove(globeStage, {
      pointerId: 7,
      clientX: 110,
      clientY: 195,
    })
    fireEvent.pointerUp(globeStage, {
      pointerId: 7,
    })

    expect(setPointerCapture).toHaveBeenCalledWith(7)
    expect(releasePointerCapture).toHaveBeenCalledWith(7)
    expect(useAppStore.getState().viewCamera).toEqual({
      azimuthDeg: -3,
      elevationDeg: -16.5,
      distance: 3.15,
    })
    expect(useAppStore.getState().globeOrientation).toEqual({
      azimuthDeg: 0,
      elevationDeg: 0,
      rollDeg: 0,
    })
    expect(useAppStore.getState().projectionFrame).toEqual({
      centralLonDeg: 0,
      centerLatDeg: 0,
    })
  })

  it('uses secondary-button drag to rotate only the globe when projection is fixed', () => {
    useAppStore.getState().toggleFixProjection()

    const { container } = render(<GlobePane />)
    const globeStage = container.querySelector('.globe-stage') as HTMLDivElement
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()

    Object.assign(globeStage, { setPointerCapture, releasePointerCapture })

    fireEvent.pointerDown(globeStage, {
      button: 2,
      pointerId: 11,
      clientX: 100,
      clientY: 200,
    })
    fireEvent.pointerMove(globeStage, {
      pointerId: 11,
      clientX: 110,
      clientY: 195,
    })
    fireEvent.pointerUp(globeStage, {
      pointerId: 11,
    })

    expect(setPointerCapture).toHaveBeenCalledWith(11)
    expect(releasePointerCapture).toHaveBeenCalledWith(11)
    expect(useAppStore.getState().globeOrientation.azimuthDeg).toBeCloseTo(-3, 6)
    expect(useAppStore.getState().globeOrientation.elevationDeg).toBeCloseTo(1.5, 6)
    expect(useAppStore.getState().globeOrientation.rollDeg ?? 0).toBeCloseTo(0, 6)
    expect(useAppStore.getState().projectionFrame).toEqual({
      centralLonDeg: 0,
      centerLatDeg: 0,
    })
    expect(useAppStore.getState().viewCamera).toEqual({
      azimuthDeg: 0,
      elevationDeg: -18,
      distance: 3.15,
    })
  })

  it('keeps fixed-frame vertical drags aligned with the current view pose', () => {
    useAppStore.getState().nudgeViewCamera(30, 12)
    useAppStore.getState().toggleFixProjection()

    const { container } = render(<GlobePane />)
    const globeStage = container.querySelector('.globe-stage') as HTMLDivElement
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()

    Object.assign(globeStage, { setPointerCapture, releasePointerCapture })

    fireEvent.pointerDown(globeStage, {
      button: 2,
      pointerId: 15,
      clientX: 100,
      clientY: 200,
    })
    fireEvent.pointerMove(globeStage, {
      pointerId: 15,
      clientX: 100,
      clientY: 195,
    })
    fireEvent.pointerUp(globeStage, {
      pointerId: 15,
    })

    expect(useAppStore.getState().viewCamera).toEqual({
      azimuthDeg: 30,
      elevationDeg: -6,
      distance: 3.15,
    })
    expect(useAppStore.getState().globeOrientation.azimuthDeg).toBeCloseTo(
      0.008501698953296,
      6,
    )
    expect(useAppStore.getState().globeOrientation.elevationDeg).toBeCloseTo(
      1.2990010148897144,
      6,
    )
    expect(useAppStore.getState().globeOrientation.rollDeg ?? 0).toBeCloseTo(
      0.7499357502670136,
      6,
    )
  })
})
