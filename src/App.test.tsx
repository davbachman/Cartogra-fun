import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { useAppStore } from './lib/store'

vi.mock('./components/GlobePane', () => ({
  GlobePane: () => <div data-testid="globe-pane">Globe pane</div>,
}))

vi.mock('./components/MapPane', () => ({
  MapPane: ({ projection }: { projection: { label: string } }) => (
    <div data-testid="map-pane">{projection.label}</div>
  ),
}))

function toLocalDateValue(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`
}

function toLocalTimeValue(date: Date) {
  return `${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}:${`${date.getSeconds()}`.padStart(2, '0')}`
}

describe('Cartogra-fun app shell', () => {
  beforeEach(() => {
    useAppStore.getState().resetStore()
  })

  it('renders the projection families in the requested order', () => {
    render(<App />)

    const select = screen.getByLabelText('Projection') as HTMLSelectElement
    const groups = Array.from(select.querySelectorAll('optgroup')).map((group) => ({
      label: group.label,
      options: Array.from(group.querySelectorAll('option')).map((option) => option.textContent),
    }))

    expect(groups).toEqual([
      {
        label: 'Cylindrical',
        options: [
          'Mercator',
          'Lambert equal-area',
          'Central',
        ],
      },
      {
        label: 'Conic',
        options: ['Albers equal-area', 'Lambert conformal', 'Central'],
      },
      {
        label: 'Azimuthal',
        options: ['Stereographic', 'Orthographic', 'Central (Gnomonic)'],
      },
    ])
  })

  it('updates the selected projection and keeps map layers always visible', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.selectOptions(screen.getByLabelText('Projection'), 'orthographic')
    expect(screen.getByTestId('map-pane')).toHaveTextContent('Orthographic')
    expect(screen.queryByLabelText('Toggle basemap')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Toggle world graticule')).not.toBeInTheDocument()
  })

  it('keeps projection visualization available across the remaining projection families', async () => {
    const user = userEvent.setup()
    render(<App />)

    const visualizationButton = screen.getByLabelText(
      'Show Projection Surface',
    )

    expect(visualizationButton).toBeEnabled()

    await user.click(visualizationButton)
    expect(useAppStore.getState().showProjectionVisualization).toBe(true)

    await user.selectOptions(screen.getByLabelText('Projection'), 'orthographic')

    expect(visualizationButton).toBeEnabled()
    expect(visualizationButton).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches interaction modes through the icon toolbar', async () => {
    const user = userEvent.setup()
    render(<App />)

    const selectTool = screen.getByLabelText('Select Point')
    const geodesicTool = screen.getByLabelText('Geodesic')
    const projectionRotateTool = screen.getByLabelText('Fix Projection Map')

    expect(selectTool).toHaveAttribute('aria-pressed', 'true')
    expect(geodesicTool).toHaveAttribute('aria-pressed', 'false')
    expect(projectionRotateTool).toHaveAttribute('aria-pressed', 'false')

    await user.click(selectTool)
    expect(useAppStore.getState().activeTool).toBe('select')
    expect(selectTool).toHaveAttribute('aria-pressed', 'true')

    await user.click(geodesicTool)
    expect(useAppStore.getState().activeTool).toBe('geodesic')
    expect(geodesicTool).toHaveAttribute('aria-pressed', 'true')

    await user.click(projectionRotateTool)
    expect(useAppStore.getState().fixProjection).toBe(true)
    expect(projectionRotateTool).toHaveAttribute('aria-pressed', 'true')
    expect(useAppStore.getState().activeTool).toBe('geodesic')

    await user.click(projectionRotateTool)
    expect(useAppStore.getState().fixProjection).toBe(false)
    expect(projectionRotateTool).toHaveAttribute('aria-pressed', 'false')
  })

  it('resets the globe pose and projection frame from the appearance toolbar', async () => {
    const user = userEvent.setup()
    useAppStore.getState().nudgeViewCamera(24, 10)
    useAppStore.getState().nudgeGlobeOrientation(36, -12)
    useAppStore.getState().nudgeProjectionFrame(18, 9)

    render(<App />)

    await user.click(screen.getByLabelText('Reset'))

    expect(useAppStore.getState().viewCamera).toEqual({
      azimuthDeg: 0,
      elevationDeg: -18,
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

  it('shows the day/night controls and lets now mode override the manual date and time', async () => {
    vi.useFakeTimers()

    try {
      const initialNow = new Date('2026-03-27T10:15:30.000Z')

      vi.setSystemTime(initialNow)
      useAppStore.getState().resetStore()

      render(<App />)

      expect(screen.queryByLabelText('Day/night date')).not.toBeInTheDocument()

      fireEvent.click(screen.getByLabelText('Day/night'))

      const dateInput = screen.getByLabelText('Day/night date')
      const timeInput = screen.getByLabelText('Day/night time')
      const nowCheckbox = screen.getByLabelText('now')

      expect(dateInput).toHaveValue(toLocalDateValue(initialNow))
      expect(timeInput).toHaveValue(toLocalTimeValue(initialNow))

      fireEvent.change(dateInput, { target: { value: '2026-04-02' } })
      fireEvent.change(timeInput, { target: { value: '05:30:15' } })

      expect(dateInput).toHaveValue('2026-04-02')
      expect(timeInput).toHaveValue('05:30:15')

      fireEvent.click(nowCheckbox)

      expect(nowCheckbox).toBeChecked()
      expect(dateInput).toBeDisabled()
      expect(timeInput).toBeDisabled()
      expect(dateInput).toHaveValue(toLocalDateValue(initialNow))
      expect(timeInput).toHaveValue(toLocalTimeValue(initialNow))

      act(() => {
        vi.advanceTimersByTime(2000)
      })

      const laterNow = new Date(initialNow.getTime() + 2000)

      expect(dateInput).toHaveValue(toLocalDateValue(laterNow))
      expect(timeInput).toHaveValue(toLocalTimeValue(laterNow))

      fireEvent.click(nowCheckbox)

      expect(nowCheckbox).not.toBeChecked()
      expect(dateInput).toBeEnabled()
      expect(timeInput).toBeEnabled()
      expect(dateInput).toHaveValue('2026-04-02')
      expect(timeInput).toHaveValue('05:30:15')
    } finally {
      vi.useRealTimers()
    }
  })
})
