import { describe, expect, it } from 'vitest'
import { analyzeIndicatrixAtPoint } from './indicatrix'
import {
  createDisplayGlobeQuaternion,
  latLonToVector3,
  vector3ToGeoPoint,
} from './math'
import { getProjectionDefinition, projectGeoPoint } from './projections'

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

  it('centers the indicatrix on the displayed globe pose for rotated maps', () => {
    const projection = getProjectionDefinition('mercator')
    const orientation = {
      azimuthDeg: 30,
      elevationDeg: 20,
      rollDeg: 10,
    }
    const point = { latDeg: 0, lonDeg: 0 }
    const analysis = analyzeIndicatrixAtPoint(
      projection,
      defaultFrame,
      orientation,
      point,
    )
    const expected = projectGeoPoint(
      projection,
      vector3ToGeoPoint(
        latLonToVector3(point).applyQuaternion(
          createDisplayGlobeQuaternion(orientation),
        ),
      ),
      defaultFrame,
    )

    expect(analysis).not.toBeNull()
    expect(expected.visible).toBe(true)
    expect(analysis?.centerRaw.x).toBeCloseTo(expected.x, 5)
    expect(analysis?.centerRaw.y).toBeCloseTo(expected.y, 5)
  })
})
