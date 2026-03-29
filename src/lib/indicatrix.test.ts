import { describe, expect, it } from 'vitest'
import { analyzeIndicatrixAtPoint } from './indicatrix'
import { getProjectionDefinition } from './projections'

const defaultFrame = {
  centralLonDeg: 0,
  centerLatDeg: 0,
}

const defaultOrientation = {
  azimuthDeg: 0,
  elevationDeg: 0,
}

describe('local indicatrix metrics', () => {
  it('keeps Mercator conformal at the equator', () => {
    const analysis = analyzeIndicatrixAtPoint(
      getProjectionDefinition('mercator'),
      defaultFrame,
      defaultOrientation,
      { latDeg: 0, lonDeg: 0 },
    )

    expect(analysis).not.toBeNull()
    expect(analysis?.metrics.areaFactor).toBeCloseTo(1, 2)
    expect(analysis?.metrics.majorScale).toBeCloseTo(1, 2)
    expect(analysis?.metrics.minorScale).toBeCloseTo(1, 2)
    expect(analysis?.metrics.eccentricity).toBeLessThan(0.02)
    expect(analysis?.metrics.angularDistortionDeg).toBeLessThan(0.2)
  })

  it('shows Mercator area inflation away from the equator', () => {
    const analysis = analyzeIndicatrixAtPoint(
      getProjectionDefinition('mercator'),
      defaultFrame,
      defaultOrientation,
      { latDeg: 60, lonDeg: 0 },
    )

    expect(analysis).not.toBeNull()
    expect(analysis?.metrics.areaFactor).toBeCloseTo(4, 1)
    expect(analysis?.metrics.eccentricity).toBeLessThan(0.02)
  })

  it('preserves area but not shape for Lambert cylindrical equal-area', () => {
    const analysis = analyzeIndicatrixAtPoint(
      getProjectionDefinition('lambert-equal-area'),
      defaultFrame,
      defaultOrientation,
      { latDeg: 60, lonDeg: 0 },
    )

    expect(analysis).not.toBeNull()
    expect(analysis?.metrics.areaFactor).toBeCloseTo(1, 2)
    expect(analysis?.metrics.majorScale).toBeGreaterThan(1.9)
    expect(analysis?.metrics.minorScale).toBeLessThan(0.55)
    expect(analysis?.metrics.eccentricity).toBeGreaterThan(0.95)
  })
})
