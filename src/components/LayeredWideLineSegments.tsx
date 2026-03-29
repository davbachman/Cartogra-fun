import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Vector2 } from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'

export type WideLineLayer = {
  color: string
  linewidth: number
  opacity?: number
}

type LayeredWideLineSegmentsProps = {
  positions: Float32Array
  layers: readonly WideLineLayer[]
  renderOrder?: number
}

export default function LayeredWideLineSegments({
  positions,
  layers,
  renderOrder = 0,
}: LayeredWideLineSegmentsProps) {
  const { gl, size } = useThree()
  const resolution = useMemo(() => new Vector2(), [])
  const geometry = useMemo(() => {
    const nextGeometry = new LineSegmentsGeometry()

    nextGeometry.setPositions(Array.from(positions))

    return nextGeometry
  }, [positions])
  const lineObjects = useMemo(() => {
    return layers.map((layer, index) => {
      const material = new LineMaterial({
        color: layer.color,
        linewidth: layer.linewidth,
        opacity: layer.opacity ?? 1,
        transparent: (layer.opacity ?? 1) < 1,
        depthWrite: false,
        toneMapped: false,
      })
      const line = new LineSegments2(geometry, material)

      line.frustumCulled = false
      line.renderOrder = renderOrder + index

      return line
    })
  }, [geometry, layers, renderOrder])

  useEffect(() => {
    gl.getDrawingBufferSize(resolution)

    for (const line of lineObjects) {
      const material = line.material

      if (material instanceof LineMaterial) {
        material.resolution.copy(resolution)
      }
    }
  }, [gl, lineObjects, resolution, size.height, size.width])

  useEffect(() => {
    return () => {
      geometry.dispose()

      for (const line of lineObjects) {
        const material = line.material

        if (material instanceof LineMaterial) {
          material.dispose()
        }
      }
    }
  }, [geometry, lineObjects])

  return (
    <>
      {lineObjects.map((line, index) => (
        <primitive key={index} object={line} />
      ))}
    </>
  )
}
