import { describe, expect, it } from 'vitest'
import { GLOBE_RADIUS } from './globeConstants'
import { sampleGeodesicArc, sampleMapLinePreimage } from './geodesic'
import { buildProjectionVisualizationModel } from './projectionVisualization'
import { createDisplayGlobeQuaternion, latLonToVector3 } from './math'
import { buildMapScene } from './mapScene'
import { getProjectionDefinition } from './projections'

const defaultFrame = {
  centralLonDeg: 0,
  centerLatDeg: 0,
}

const defaultOrientation = {
  azimuthDeg: 0,
  elevationDeg: 0,
}

describe('projection visualization model', () => {
  it('keeps azimuthal plane visualizations solid on the globe', () => {
    const orthographic = buildProjectionVisualizationModel(
      getProjectionDefinition('orthographic'),
      defaultFrame,
      defaultOrientation,
      null,
    )
    const stereographic = buildProjectionVisualizationModel(
      getProjectionDefinition('stereographic'),
      defaultFrame,
      defaultOrientation,
      null,
    )
    const gnomonic = buildProjectionVisualizationModel(
      getProjectionDefinition('gnomonic'),
      defaultFrame,
      defaultOrientation,
      null,
    )

    expect(orthographic.translucentGlobe).toBe(false)
    expect(stereographic.translucentGlobe).toBe(false)
    expect(gnomonic.translucentGlobe).toBe(false)
  })

  it('keeps azimuthal projection planes outside the globe', () => {
    const orthographic = buildProjectionVisualizationModel(
      getProjectionDefinition('orthographic'),
      defaultFrame,
      defaultOrientation,
      null,
    )

    expect(orthographic.shell?.type).toBe('plane')

    if (orthographic.shell?.type !== 'plane') {
      throw new Error('Expected orthographic visualization shell to be a plane.')
    }

    for (const corner of orthographic.shell.corners) {
      expect(corner[0]).toBeGreaterThan(GLOBE_RADIUS)
    }
  })

  it('keeps azimuthal plane points in the correct hemisphere', () => {
    for (const projectionId of [
      'orthographic',
      'stereographic',
      'gnomonic',
    ]) {
      const north = buildProjectionVisualizationModel(
        getProjectionDefinition(projectionId),
        defaultFrame,
        defaultOrientation,
        { latDeg: 30, lonDeg: 0 },
      )
      const south = buildProjectionVisualizationModel(
        getProjectionDefinition(projectionId),
        defaultFrame,
        defaultOrientation,
        { latDeg: -30, lonDeg: 0 },
      )

      expect(north.selectionSurfacePoint).not.toBeNull()
      expect(south.selectionSurfacePoint).not.toBeNull()

      if (!north.selectionSurfacePoint || !south.selectionSurfacePoint) {
        throw new Error(`Expected ${projectionId} to return visible azimuthal points.`)
      }

      expect(north.selectionSurfacePoint[1]).toBeGreaterThan(0)
      expect(south.selectionSurfacePoint[1]).toBeLessThan(0)
      expect(north.selectionSurfacePoint[0]).toBeCloseTo(
        south.selectionSurfacePoint[0],
        6,
      )
      expect(north.selectionSurfacePoint[2]).toBeCloseTo(
        south.selectionSurfacePoint[2],
        6,
      )
    }
  })

  it('keeps azimuthal plane points aligned with the correct meridian', () => {
    for (const projectionId of [
      'orthographic',
      'stereographic',
      'gnomonic',
    ]) {
      const center = buildProjectionVisualizationModel(
        getProjectionDefinition(projectionId),
        defaultFrame,
        defaultOrientation,
        { latDeg: 0, lonDeg: 0 },
      )
      const east = buildProjectionVisualizationModel(
        getProjectionDefinition(projectionId),
        defaultFrame,
        defaultOrientation,
        { latDeg: 0, lonDeg: 30 },
      )
      const west = buildProjectionVisualizationModel(
        getProjectionDefinition(projectionId),
        defaultFrame,
        defaultOrientation,
        { latDeg: 0, lonDeg: -30 },
      )

      expect(center.selectionSurfacePoint).not.toBeNull()
      expect(east.selectionSurfacePoint).not.toBeNull()
      expect(west.selectionSurfacePoint).not.toBeNull()

      if (
        !center.selectionSurfacePoint ||
        !east.selectionSurfacePoint ||
        !west.selectionSurfacePoint
      ) {
        throw new Error(`Expected ${projectionId} to return visible azimuthal points.`)
      }

      expect(center.selectionSurfacePoint[2]).toBeCloseTo(0, 6)
      expect(east.selectionSurfacePoint[2]).toBeLessThan(0)
      expect(west.selectionSurfacePoint[2]).toBeGreaterThan(0)
      expect(east.selectionSurfacePoint[0]).toBeCloseTo(
        west.selectionSurfacePoint[0],
        6,
      )
      expect(east.selectionSurfacePoint[1]).toBeCloseTo(
        west.selectionSurfacePoint[1],
        6,
      )
    }
  })

  it('keeps conic surface geometry aligned to the globe meridians', () => {
    for (const projectionId of [
      'albers-equal-area',
      'lambert-conformal',
      'conic-point-geometric',
    ]) {
      const projection = getProjectionDefinition(projectionId)
      const center = buildProjectionVisualizationModel(
        projection,
        defaultFrame,
        defaultOrientation,
        { latDeg: 35, lonDeg: 0 },
      )
      const east = buildProjectionVisualizationModel(
        projection,
        defaultFrame,
        defaultOrientation,
        { latDeg: 35, lonDeg: 30 },
      )
      const west = buildProjectionVisualizationModel(
        projection,
        defaultFrame,
        defaultOrientation,
        { latDeg: 35, lonDeg: -30 },
      )

      expect(center.selectionSurfacePoint).not.toBeNull()
      expect(east.selectionSurfacePoint).not.toBeNull()
      expect(west.selectionSurfacePoint).not.toBeNull()

      if (
        !center.selectionSurfacePoint ||
        !east.selectionSurfacePoint ||
        !west.selectionSurfacePoint
      ) {
        throw new Error(`Expected ${projectionId} to return visible conic surface points.`)
      }

      expect(center.selectionSurfacePoint[2]).toBeCloseTo(0, 6)
      expect(east.selectionSurfacePoint[2]).toBeLessThan(0)
      expect(west.selectionSurfacePoint[2]).toBeGreaterThan(0)
      expect(east.selectionSurfacePoint[0]).toBeCloseTo(
        west.selectionSurfacePoint[0],
        6,
      )
      expect(east.selectionSurfacePoint[1]).toBeCloseTo(
        west.selectionSurfacePoint[1],
        6,
      )
    }
  })

  it('keeps non-geometric cylindrical surfaces from forcing globe translucency', () => {
    const mercator = buildProjectionVisualizationModel(
      getProjectionDefinition('mercator'),
      defaultFrame,
      defaultOrientation,
      null,
    )

    expect(mercator.translucentGlobe).toBe(false)
  })

  it('keeps cylindrical surface points in the correct hemisphere', () => {
    for (const projectionId of [
      'mercator',
      'lambert-equal-area',
      'cylindrical-point-geometric',
    ]) {
      const north = buildProjectionVisualizationModel(
        getProjectionDefinition(projectionId),
        defaultFrame,
        defaultOrientation,
        { latDeg: 30, lonDeg: 0 },
      )
      const south = buildProjectionVisualizationModel(
        getProjectionDefinition(projectionId),
        defaultFrame,
        defaultOrientation,
        { latDeg: -30, lonDeg: 0 },
      )

      expect(north.selectionSurfacePoint).not.toBeNull()
      expect(south.selectionSurfacePoint).not.toBeNull()

      if (!north.selectionSurfacePoint || !south.selectionSurfacePoint) {
        throw new Error(`Expected ${projectionId} to return visible cylindrical points.`)
      }

      expect(north.selectionSurfacePoint[1]).toBeGreaterThan(0)
      expect(south.selectionSurfacePoint[1]).toBeLessThan(0)
      expect(north.selectionSurfacePoint[0]).toBeCloseTo(
        south.selectionSurfacePoint[0],
        6,
      )
      expect(north.selectionSurfacePoint[2]).toBeCloseTo(
        south.selectionSurfacePoint[2],
        6,
      )
    }
  })

  it('keeps cylindrical surface points aligned with the correct meridian', () => {
    for (const projectionId of [
      'mercator',
      'lambert-equal-area',
      'cylindrical-point-geometric',
    ]) {
      const center = buildProjectionVisualizationModel(
        getProjectionDefinition(projectionId),
        defaultFrame,
        defaultOrientation,
        { latDeg: 35, lonDeg: 0 },
      )
      const east = buildProjectionVisualizationModel(
        getProjectionDefinition(projectionId),
        defaultFrame,
        defaultOrientation,
        { latDeg: 35, lonDeg: 30 },
      )
      const west = buildProjectionVisualizationModel(
        getProjectionDefinition(projectionId),
        defaultFrame,
        defaultOrientation,
        { latDeg: 35, lonDeg: -30 },
      )

      expect(center.selectionSurfacePoint).not.toBeNull()
      expect(east.selectionSurfacePoint).not.toBeNull()
      expect(west.selectionSurfacePoint).not.toBeNull()

      if (
        !center.selectionSurfacePoint ||
        !east.selectionSurfacePoint ||
        !west.selectionSurfacePoint
      ) {
        throw new Error(`Expected ${projectionId} to return visible cylindrical points.`)
      }

      expect(center.selectionSurfacePoint[2]).toBeCloseTo(0, 6)
      expect(east.selectionSurfacePoint[2]).toBeLessThan(0)
      expect(west.selectionSurfacePoint[2]).toBeGreaterThan(0)
      expect(east.selectionSurfacePoint[0]).toBeCloseTo(
        west.selectionSurfacePoint[0],
        6,
      )
      expect(east.selectionSurfacePoint[1]).toBeCloseTo(
        west.selectionSurfacePoint[1],
        6,
      )
    }
  })

  it('keeps geometric projection visuals from dimming the globe', () => {
    for (const projectionId of [
      'cylindrical-point-geometric',
      'conic-point-geometric',
    ]) {
      const model = buildProjectionVisualizationModel(
        getProjectionDefinition(projectionId),
        defaultFrame,
        defaultOrientation,
        null,
      )

      expect(model.translucentGlobe).toBe(false)
    }
  })

  it('omits source overlays for stereographic and cylindrical geometric projections', () => {
    const stereographic = buildProjectionVisualizationModel(
      getProjectionDefinition('stereographic'),
      defaultFrame,
      defaultOrientation,
      { latDeg: 20, lonDeg: 15 },
    )
    const cylindricalPoint = buildProjectionVisualizationModel(
      getProjectionDefinition('cylindrical-point-geometric'),
      defaultFrame,
      defaultOrientation,
      { latDeg: 20, lonDeg: 15 },
    )

    expect(stereographic.sourcePoint).toBeNull()
    expect(stereographic.sourceLine).toBeNull()
    expect(cylindricalPoint.sourcePoint).toBeNull()
    expect(cylindricalPoint.sourceLine).toBeNull()
    expect(stereographic.selectionRay).not.toBeNull()
    expect(cylindricalPoint.selectionRay).not.toBeNull()
  })

  it('shows globe-to-surface segments for all supported projection visualizations', () => {
    for (const projectionId of [
      'mercator',
      'lambert-equal-area',
      'stereographic',
      'orthographic',
      'gnomonic',
      'cylindrical-point-geometric',
      'albers-equal-area',
      'lambert-conformal',
      'conic-point-geometric',
    ]) {
      const model = buildProjectionVisualizationModel(
        getProjectionDefinition(projectionId),
        defaultFrame,
        defaultOrientation,
        { latDeg: 20, lonDeg: 15 },
      )

      expect(model.selectionSurfacePoint).not.toBeNull()
      expect(model.selectionRay).not.toBeNull()
    }
  })

  it('starts geometric selection rays from the displayed globe position', () => {
    const orientation = {
      azimuthDeg: 18,
      elevationDeg: 12,
      rollDeg: 9,
    }
    const selection = { latDeg: 20, lonDeg: 15 }
    const model = buildProjectionVisualizationModel(
      getProjectionDefinition('cylindrical-point-geometric'),
      defaultFrame,
      orientation,
      selection,
    )

    expect(model.selectionRay).not.toBeNull()

    if (!model.selectionRay) {
      throw new Error('Expected a geometric selection ray.')
    }

    const expected = latLonToVector3(selection)
      .applyQuaternion(createDisplayGlobeQuaternion(orientation))
      .normalize()
    const actualLength = Math.hypot(...model.selectionRay.start)
    const actual = {
      x: model.selectionRay.start[0] / actualLength,
      y: model.selectionRay.start[1] / actualLength,
      z: model.selectionRay.start[2] / actualLength,
    }

    expect(actual.x).toBeCloseTo(expected.x, 6)
    expect(actual.y).toBeCloseTo(expected.y, 6)
    expect(actual.z).toBeCloseTo(expected.z, 6)
  })

  it('keeps a rotated globe selection aligned with its orthographic surface image', () => {
    const orientation = {
      azimuthDeg: 30,
      elevationDeg: 0,
      rollDeg: 0,
    }
    const model = buildProjectionVisualizationModel(
      getProjectionDefinition('orthographic'),
      defaultFrame,
      orientation,
      { latDeg: 0, lonDeg: 0 },
    )

    expect(model.selectionSurfacePoint).not.toBeNull()
    expect(model.selectionRay).not.toBeNull()

    if (!model.selectionSurfacePoint || !model.selectionRay) {
      throw new Error('Expected the rotated orthographic selection image to be visible.')
    }

    expect(model.selectionSurfacePoint[2]).toBeGreaterThan(0)
    expect(model.selectionRay.end[2]).toBeCloseTo(model.selectionSurfacePoint[2], 6)
    expect(model.selectionRay.start[2]).toBeGreaterThan(0)
  })

  it('projects visible globe geodesics onto the projection surface', () => {
    const start = { latDeg: 0, lonDeg: -20 }
    const end = { latDeg: 0, lonDeg: 20 }
    const model = buildProjectionVisualizationModel(
      getProjectionDefinition('orthographic'),
      defaultFrame,
      defaultOrientation,
      null,
      {
        endpoints: [start, end],
        segments: [sampleGeodesicArc(start, end, 24)],
      },
    )

    expect(model.curveSurfacePositions.length).toBeGreaterThan(0)
    expect(model.curveSurfaceEndpoints).toHaveLength(2)

    for (const point of model.curveSurfaceEndpoints) {
      expect(point[0]).toBeGreaterThan(GLOBE_RADIUS)
    }
  })

  it('projects map-line preimages onto the projection surface', () => {
    const projection = getProjectionDefinition('mercator')
    const start = { latDeg: -20, lonDeg: -20 }
    const end = { latDeg: 20, lonDeg: 20 }
    const scene = buildMapScene(
      projection,
      defaultFrame,
      defaultOrientation,
      { width: 1280, height: 720 },
    )
    const segments = sampleMapLinePreimage(scene, start, end)
    const model = buildProjectionVisualizationModel(
      projection,
      defaultFrame,
      defaultOrientation,
      null,
      {
        endpoints: [start, end],
        segments,
      },
    )

    expect(segments.length).toBeGreaterThan(0)
    expect(model.curveSurfacePositions.length).toBeGreaterThan(0)
    expect(model.curveSurfaceEndpoints).toHaveLength(2)

    for (const point of model.curveSurfaceEndpoints) {
      expect(Math.hypot(point[0], point[2])).toBeCloseTo(GLOBE_RADIUS, 6)
    }
  })
})
