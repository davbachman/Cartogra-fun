import { describe, expect, it } from 'vitest'
import { Vector2 } from 'three'
import { buildMapScene, pickGeoPointFromScene } from './mapScene'
import {
  createDisplayGlobeQuaternion,
  latLonToVector3,
  vector3ToGeoPoint,
} from './math'
import { getProjectionDefinition, projectGeoPoint } from './projections'

const size = { width: 1080, height: 720 }
const orientation = { azimuthDeg: 0, elevationDeg: 0 }

describe('map scene generation', () => {
  it('round-trips a selected point on the Mercator map through triangle picking', () => {
    const projection = getProjectionDefinition('mercator')
    const frame = { centralLonDeg: 0, centerLatDeg: 0 }
    const point = { latDeg: 18, lonDeg: 28 }
    const scene = buildMapScene(projection, frame, orientation, size)
    const screenPoint = scene.projectGeoToScreen(point)

    expect(screenPoint).not.toBeNull()

    const recovered = pickGeoPointFromScene(scene, screenPoint!.x, screenPoint!.y)

    expect(recovered).not.toBeNull()
    expect(recovered!.latDeg).toBeCloseTo(point.latDeg, 1)
    expect(recovered!.lonDeg).toBeCloseTo(point.lonDeg, 1)
  })

  it('changes projected screen coordinates when the projection frame rotates', () => {
    const projection = getProjectionDefinition('mercator')
    const point = { latDeg: 0, lonDeg: 0 }
    const centeredScene = buildMapScene(
      projection,
      { centralLonDeg: 0, centerLatDeg: 0 },
      orientation,
      size,
    )
    const rotatedScene = buildMapScene(
      projection,
      { centralLonDeg: 55, centerLatDeg: 18 },
      orientation,
      size,
    )
    const centered = centeredScene.projectGeoToScreen(point)
    const rotated = rotatedScene.projectGeoToScreen(point)

    expect(centered).not.toBeNull()
    expect(rotated).not.toBeNull()
    expect(rotated!.x).not.toBeCloseTo(centered!.x, 1)
    expect(rotated!.y).not.toBeCloseTo(centered!.y, 1)
  })

  it('projects rotated globe points from the displayed globe pose', () => {
    const projection = getProjectionDefinition('mercator')
    const frame = { centralLonDeg: 0, centerLatDeg: 0 }
    const rotatedOrientation = {
      azimuthDeg: 30,
      elevationDeg: 20,
      rollDeg: 10,
    }
    const point = { latDeg: 0, lonDeg: 0 }
    const scene = buildMapScene(projection, frame, rotatedOrientation, size)
    const screenPoint = scene.projectGeoToScreen(point)
    const expectedRaw = projectGeoPoint(
      projection,
      vector3ToGeoPoint(
        latLonToVector3(point).applyQuaternion(
          createDisplayGlobeQuaternion(rotatedOrientation),
        ),
      ),
      frame,
    )

    expect(expectedRaw.visible).toBe(true)
    expect(screenPoint).not.toBeNull()

    const expectedScreen = scene.rawToScreen(expectedRaw)

    expect(screenPoint!.x).toBeCloseTo(expectedScreen.x, 5)
    expect(screenPoint!.y).toBeCloseTo(expectedScreen.y, 5)
  })

  it('keeps the Mercator frame bounds stable when the projection frame rotates', () => {
    const projection = getProjectionDefinition('mercator')
    const centeredScene = buildMapScene(
      projection,
      { centralLonDeg: 0, centerLatDeg: 0 },
      orientation,
      size,
    )
    const rotatedScene = buildMapScene(
      projection,
      { centralLonDeg: 55, centerLatDeg: 18 },
      orientation,
      size,
    )

    expect(centeredScene.bounds.minX).toBeCloseTo(-Math.PI, 5)
    expect(centeredScene.bounds.maxX).toBeCloseTo(Math.PI, 5)
    expect(rotatedScene.bounds.minX).toBeCloseTo(centeredScene.bounds.minX, 5)
    expect(rotatedScene.bounds.maxX).toBeCloseTo(centeredScene.bounds.maxX, 5)
    expect(rotatedScene.bounds.minY).toBeCloseTo(centeredScene.bounds.minY, 5)
    expect(rotatedScene.bounds.maxY).toBeCloseTo(centeredScene.bounds.maxY, 5)
    expect(centeredScene.frameOutline).not.toBeNull()
    expect(rotatedScene.frameOutline).not.toBeNull()
  })

  it('builds a usable projected scene for every projection', () => {
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
      const scene = buildMapScene(
        projection,
        { centralLonDeg: 0, centerLatDeg: 0 },
        orientation,
        size,
      )
      const marker = scene.projectGeoToScreen({ latDeg: 12, lonDeg: 24 })

      expect(scene.triangles.length).toBeGreaterThan(4000)
      expect(scene.graticuleLines.length).toBeGreaterThan(10)
      expect(Number.isFinite(scene.bounds.minX)).toBe(true)
      expect(Number.isFinite(scene.bounds.minY)).toBe(true)
      expect(Number.isFinite(scene.bounds.maxX)).toBe(true)
      expect(Number.isFinite(scene.bounds.maxY)).toBe(true)
      expect(scene.bounds.maxX).toBeGreaterThan(scene.bounds.minX)
      expect(scene.bounds.maxY).toBeGreaterThan(scene.bounds.minY)

      if (marker) {
        expect(Number.isFinite(marker.x)).toBe(true)
        expect(Number.isFinite(marker.y)).toBe(true)
      }

      expect(scene.frameOutline).not.toBeNull()
      expect(scene.frameOutline!.length).toBeGreaterThan(3)
    }
  })

  it('does not pick outside the visible frame outline', () => {
    const scene = {
      triangles: [
        {
          points: [new Vector2(0, 0), new Vector2(10, 0), new Vector2(0, 10)] as [
            Vector2,
            Vector2,
            Vector2,
          ],
          texturePoints: [new Vector2(), new Vector2(), new Vector2()] as [
            Vector2,
            Vector2,
            Vector2,
          ],
          vectors: [
            latLonToVector3({ latDeg: 0, lonDeg: 0 }),
            latLonToVector3({ latDeg: 0, lonDeg: 10 }),
            latLonToVector3({ latDeg: 10, lonDeg: 0 }),
          ] as [ReturnType<typeof latLonToVector3>, ReturnType<typeof latLonToVector3>, ReturnType<typeof latLonToVector3>],
        },
      ],
      graticuleLines: [],
      frameOutline: [new Vector2(0, 0), new Vector2(5, 0), new Vector2(0, 5)],
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      rawToScreen: () => new Vector2(),
      projectGeoToScreen: () => null,
    }

    expect(pickGeoPointFromScene(scene, 8, 1)).toBeNull()
  })
})
