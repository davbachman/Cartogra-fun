import { describe, expect, it } from 'vitest'
import {
  getProjectionDefinition,
  groupedProjectionRegistry,
  supportsProjectionVisualization,
} from './projections'

const defaultFrame = {
  centralLonDeg: 0,
  centerLatDeg: 0,
}

describe('projection registry', () => {
  it('keeps the grouped family order requested by the spec', () => {
    expect(
      groupedProjectionRegistry.map((group) => ({
        family: group.family,
        labels: group.projections.map((projection) => projection.label),
      })),
    ).toEqual([
      {
        family: 'Cylindrical',
        labels: [
          'Mercator',
          'Lambert equal-area',
          'Central',
        ],
      },
      {
        family: 'Conic',
        labels: ['Albers equal-area', 'Lambert conformal', 'Central'],
      },
      {
        family: 'Azimuthal',
        labels: ['Stereographic', 'Orthographic', 'Central (Gnomonic)'],
      },
    ])
  })
})

describe('forward projection behavior', () => {
  it('maps the projection center to the origin for the exact projections', () => {
    for (const projectionId of [
      'mercator',
      'lambert-equal-area',
      'cylindrical-point-geometric',
      'albers-equal-area',
      'lambert-conformal',
      'conic-point-geometric',
      'stereographic',
      'orthographic',
      'gnomonic',
    ]) {
      const projection = getProjectionDefinition(projectionId)
      const projected = projection.forward(
        { latDeg: 0, lonDeg: 0 },
        defaultFrame,
        projection.defaults,
      )

      expect(projected.visible).toBe(true)
      expect(projected.x).toBeCloseTo(0, 5)
      expect(projected.y).toBeCloseTo(0, 5)
    }
  })

  it('clips Mercator near the poles', () => {
    const projection = getProjectionDefinition('mercator')
    const visible = projection.forward(
      { latDeg: 80, lonDeg: 0 },
      defaultFrame,
      projection.defaults,
    )
    const clipped = projection.forward(
      { latDeg: 88, lonDeg: 0 },
      defaultFrame,
      projection.defaults,
    )

    expect(visible.visible).toBe(true)
    expect(clipped.visible).toBe(false)
  })

  it('clips the cylindrical point construction near the poles', () => {
    const projection = getProjectionDefinition('cylindrical-point-geometric')

    expect(
      projection.forward(
        { latDeg: 60, lonDeg: 0 },
        defaultFrame,
        projection.defaults,
      ).visible,
    ).toBe(true)
    expect(
      projection.forward(
        { latDeg: 84, lonDeg: 0 },
        defaultFrame,
        projection.defaults,
      ).visible,
    ).toBe(false)
  })

  it('preserves the Lambert cylindrical equal-area pole limit', () => {
    const projection = getProjectionDefinition('lambert-equal-area')
    const northPole = projection.forward(
      { latDeg: 90, lonDeg: 0 },
      defaultFrame,
      projection.defaults,
    )
    const southPole = projection.forward(
      { latDeg: -90, lonDeg: 0 },
      defaultFrame,
      projection.defaults,
    )

    expect(northPole.y).toBeCloseTo(1, 5)
    expect(southPole.y).toBeCloseTo(-1, 5)
  })

  it('supports visualization only for cylindrical, conic, and azimuthal projections', () => {
    expect(
      supportsProjectionVisualization(getProjectionDefinition('mercator')),
    ).toBe(true)
    expect(
      supportsProjectionVisualization(getProjectionDefinition('conic-point-geometric')),
    ).toBe(true)
    expect(
      supportsProjectionVisualization(getProjectionDefinition('orthographic')),
    ).toBe(true)
  })

  it('clips the far hemisphere for orthographic and the horizon for gnomonic', () => {
    const orthographic = getProjectionDefinition('orthographic')
    const gnomonic = getProjectionDefinition('gnomonic')

    expect(
      orthographic.forward(
        { latDeg: 0, lonDeg: 180 },
        defaultFrame,
        orthographic.defaults,
      ).visible,
    ).toBe(false)
    expect(
      gnomonic.forward(
        { latDeg: 0, lonDeg: 90 },
        defaultFrame,
        gnomonic.defaults,
      ).visible,
    ).toBe(false)
  })
})
