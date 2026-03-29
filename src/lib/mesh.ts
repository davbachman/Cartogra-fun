import { Vector3 } from 'three'
import { latLonToVector3 } from './math'
import type { GeoPoint } from './types'

export interface MeshVertex {
  geo: GeoPoint
  vector: Vector3
}

export interface MeshTriangle {
  indices: [number, number, number]
}

export interface BaseMapMesh {
  vertices: MeshVertex[]
  triangles: MeshTriangle[]
  graticuleLines: GeoPoint[][]
}

const LAT_SEGMENTS = 160
const LON_SEGMENTS = 320

function createGraticuleLines() {
  const lines: GeoPoint[][] = []

  for (let longitude = -180; longitude < 180; longitude += 15) {
    const meridian: GeoPoint[] = []

    for (let latitude = -90; latitude <= 90; latitude += 1) {
      meridian.push({ latDeg: latitude, lonDeg: longitude })
    }

    lines.push(meridian)
  }

  for (let latitude = -75; latitude <= 75; latitude += 15) {
    const parallel: GeoPoint[] = []

    for (let longitude = -180; longitude <= 180; longitude += 1) {
      parallel.push({ latDeg: latitude, lonDeg: longitude })
    }

    lines.push(parallel)
  }

  return lines
}

function createBaseMapMesh(): BaseMapMesh {
  const vertices: MeshVertex[] = []
  const triangles: MeshTriangle[] = []
  const stride = LON_SEGMENTS + 1

  for (let latIndex = 0; latIndex <= LAT_SEGMENTS; latIndex += 1) {
    const latDeg = 90 - (latIndex * 180) / LAT_SEGMENTS

    for (let lonIndex = 0; lonIndex <= LON_SEGMENTS; lonIndex += 1) {
      const lonDeg = -180 + (lonIndex * 360) / LON_SEGMENTS
      const geo = { latDeg, lonDeg }

      vertices.push({
        geo,
        vector: latLonToVector3(geo),
      })
    }
  }

  for (let latIndex = 0; latIndex < LAT_SEGMENTS; latIndex += 1) {
    for (let lonIndex = 0; lonIndex < LON_SEGMENTS; lonIndex += 1) {
      const a = latIndex * stride + lonIndex
      const b = a + 1
      const c = a + stride
      const d = c + 1

      triangles.push({
        indices: [a, b, d],
      })
      triangles.push({
        indices: [a, d, c],
      })
    }
  }

  return {
    vertices,
    triangles,
    graticuleLines: createGraticuleLines(),
  }
}

export const baseMapMesh = createBaseMapMesh()
