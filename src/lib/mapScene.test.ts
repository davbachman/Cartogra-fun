import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector2, Vector3 } from 'three'
import { buildMapScene, pickGeoPointFromScene } from './mapScene'
import {
  createDisplayGlobeQuaternion,
  latLonToVector3,
  vector3ToGeoPoint,
} from './math'
import { getProjectionDefinition, projectGeoPoint } from './projections'

const size = { width: 1080, height: 720 }
const orientation = { azimuthDeg: 0, elevationDeg: 0 }
const defaultViewCamera = { azimuthDeg: 0, elevationDeg: -18 }

function createSceneRotationQuaternion(
  azimuthDeg: number,
  elevationDeg: number,
) {
  const tilt = new Quaternion().setFromAxisAngle(
    new Vector3(1, 0, 0),
    (-elevationDeg * Math.PI) / 180,
  )
  const spin = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    (-azimuthDeg * Math.PI) / 180,
  )

  return tilt.multiply(spin).normalize()
}

function extractDisplayGlobeOrientation(quaternion: Quaternion) {
  const euler = new Euler().setFromQuaternion(quaternion, 'XYZ')

  return {
    azimuthDeg: (((( -euler.y * 180) / Math.PI) + 180) % 360 + 360) % 360 - 180,
    elevationDeg: Math.max(-75, Math.min(75, (-euler.x * 180) / Math.PI)),
    rollDeg: (((( (euler.z * 180) / Math.PI) + 180) % 360) + 360) % 360 - 180,
  }
}

function getScreenPoint(vector: Vector3) {
  const cameraZ = 4.05
  const depth = cameraZ - vector.z

  return new Vector2(vector.x / depth, vector.y / depth)
}

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

  it('keeps fixed-frame cylindrical map motion aligned with left/up globe motion', () => {
    const projection = getProjectionDefinition('mercator')
    const frame = { centralLonDeg: 0, centerLatDeg: 0 }
    const currentView = createSceneRotationQuaternion(
      defaultViewCamera.azimuthDeg,
      defaultViewCamera.elevationDeg,
    )
    const fixedFrameDragDeltas = [
      { deltaAzimuthDeg: 1, deltaElevationDeg: 0 },
      { deltaAzimuthDeg: -1, deltaElevationDeg: 0 },
      { deltaAzimuthDeg: 0, deltaElevationDeg: 1 },
      { deltaAzimuthDeg: 0, deltaElevationDeg: -1 },
      { deltaAzimuthDeg: 1, deltaElevationDeg: 1 },
      { deltaAzimuthDeg: 1, deltaElevationDeg: -1 },
      { deltaAzimuthDeg: -1, deltaElevationDeg: 1 },
      { deltaAzimuthDeg: -1, deltaElevationDeg: -1 },
    ]

    for (let azimuthDeg = -60; azimuthDeg <= 60; azimuthDeg += 10) {
      for (let elevationDeg = -45; elevationDeg <= 45; elevationDeg += 10) {
        for (let rollDeg = 40; rollDeg <= 140; rollDeg += 10) {
          const globeOrientation = { azimuthDeg, elevationDeg, rollDeg }
          const globeQuaternion = createDisplayGlobeQuaternion(globeOrientation)
          const northPoleWorld = latLonToVector3({ latDeg: 90, lonDeg: 0 })
            .applyQuaternion(globeQuaternion)
            .applyQuaternion(currentView)
          const northPoleScreen = getScreenPoint(northPoleWorld)
          let frontmostPoint: { latDeg: number; lonDeg: number } | null = null
          let frontmostDepth = -Infinity

          for (let latDeg = -90; latDeg <= 90; latDeg += 10) {
            for (let lonDeg = -180; lonDeg <= 180; lonDeg += 10) {
              const world = latLonToVector3({ latDeg, lonDeg })
                .applyQuaternion(globeQuaternion)
                .applyQuaternion(currentView)

              if (world.z > frontmostDepth) {
                frontmostDepth = world.z
                frontmostPoint = { latDeg, lonDeg }
              }
            }
          }

          if (
            !frontmostPoint ||
            Math.abs(frontmostPoint.latDeg) > 25 ||
            northPoleScreen.x >= -0.1 ||
            frontmostDepth <= 0.9
          ) {
            continue
          }

          const baseScreenPoint = getScreenPoint(
            latLonToVector3(frontmostPoint)
              .applyQuaternion(globeQuaternion)
              .applyQuaternion(currentView),
          )
          const baseProjected = projectGeoPoint(
            projection,
            vector3ToGeoPoint(
              latLonToVector3(frontmostPoint).applyQuaternion(globeQuaternion),
            ),
            frame,
          )

          expect(baseProjected.visible).toBe(true)

          for (const dragDelta of fixedFrameDragDeltas) {
            const nextView = createSceneRotationQuaternion(
              defaultViewCamera.azimuthDeg + dragDelta.deltaAzimuthDeg,
              defaultViewCamera.elevationDeg + dragDelta.deltaElevationDeg,
            )
            const nextGlobeQuaternion = currentView
              .clone()
              .invert()
              .multiply(nextView)
              .multiply(globeQuaternion)
            const nextOrientation = extractDisplayGlobeOrientation(nextGlobeQuaternion)
            const nextDisplayQuaternion = createDisplayGlobeQuaternion(nextOrientation)
            const nextScreenPoint = getScreenPoint(
              latLonToVector3(frontmostPoint)
                .applyQuaternion(nextDisplayQuaternion)
                .applyQuaternion(currentView),
            )
            const nextProjected = projectGeoPoint(
              projection,
              vector3ToGeoPoint(
                latLonToVector3(frontmostPoint).applyQuaternion(nextDisplayQuaternion),
              ),
              frame,
            )

            expect(nextProjected.visible).toBe(true)

            const screenDx = nextScreenPoint.x - baseScreenPoint.x
            const screenDy = nextScreenPoint.y - baseScreenPoint.y
            const mapDx = nextProjected.x - baseProjected.x
            const mapDy = nextProjected.y - baseProjected.y

            if (screenDx < -1e-4) {
              expect(mapDx).not.toBeGreaterThan(1e-4)
            }

            if (screenDy > 1e-4) {
              expect(mapDy).not.toBeLessThan(-1e-4)
            }
          }
        }
      }
    }
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
