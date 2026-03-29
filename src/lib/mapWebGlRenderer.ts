import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  DynamicDrawUsage,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three'
import { getEarthTextureCanvas, type EarthTextureRequest } from './earthTexture'
import type { MapScene } from './mapScene'
import type { Size } from './types'

export interface MapBasemapRenderer {
  render: (
    scene: MapScene,
    size: Size,
    visible: boolean,
    textureRequest: EarthTextureRequest,
    textureVersion: number,
  ) => void
  dispose: () => void
}

class WebGlMapBasemapRenderer implements MapBasemapRenderer {
  private readonly canvas: HTMLCanvasElement

  private readonly renderer: WebGLRenderer

  private readonly scene = new Scene()

  private readonly camera = new OrthographicCamera(0, 1, 1, 0, -1, 1)

  private readonly geometry = new BufferGeometry()

  private readonly material = new MeshBasicMaterial({
    transparent: true,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })

  private readonly mesh = new Mesh(this.geometry, this.material)

  private readonly texture = new CanvasTexture(getEarthTextureCanvas())

  private width = 0

  private height = 0

  private pixelRatio = 0

  private textureFingerprint = ''

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = SRGBColorSpace

    this.texture.colorSpace = SRGBColorSpace
    // MapScene texture coordinates follow canvas/image space, where v=0 is the
    // top row. Disable Three's default flip so the projected basemap keeps the
    // same north-up orientation as the old 2D canvas rasterizer.
    this.texture.flipY = false
    this.texture.minFilter = LinearFilter
    this.texture.magFilter = LinearFilter
    this.texture.generateMipmaps = false
    this.texture.needsUpdate = true
    this.material.map = this.texture

    this.mesh.frustumCulled = false
    this.mesh.matrixAutoUpdate = false
    this.mesh.updateMatrix()
    this.scene.add(this.mesh)
  }

  render(
    mapScene: MapScene,
    size: Size,
    visible: boolean,
    textureRequest: EarthTextureRequest,
    textureVersion: number,
  ) {
    this.syncSize(size)

    if (!visible || mapScene.triangles.length === 0) {
      this.mesh.visible = false
      this.renderer.render(this.scene, this.camera)
      return
    }

    this.mesh.visible = true
    this.syncTexture(textureRequest, textureVersion)
    this.syncGeometry(mapScene, size)
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
    this.texture.dispose()
    this.renderer.dispose()
  }

  private syncSize(size: Size) {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)

    if (
      this.width === size.width &&
      this.height === size.height &&
      this.pixelRatio === pixelRatio
    ) {
      return
    }

    this.width = size.width
    this.height = size.height
    this.pixelRatio = pixelRatio
    this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setSize(size.width, size.height, false)
    this.canvas.style.width = `${size.width}px`
    this.canvas.style.height = `${size.height}px`
    this.camera.left = 0
    this.camera.right = size.width
    this.camera.top = size.height
    this.camera.bottom = 0
    this.camera.updateProjectionMatrix()
  }

  private syncTexture(
    textureRequest: EarthTextureRequest,
    textureVersion: number,
  ) {
    const nextTexture = getEarthTextureCanvas(textureRequest)
    const nextFingerprint = `${textureVersion}:${textureRequest.showDayNight ? textureRequest.timestampMs : 'day'}`

    if (
      this.texture.image === nextTexture &&
      this.textureFingerprint === nextFingerprint
    ) {
      return
    }

    this.texture.image = nextTexture
    this.texture.name = `map-earth-texture-${nextFingerprint}`
    this.texture.needsUpdate = true
    this.textureFingerprint = nextFingerprint
  }

  private syncGeometry(mapScene: MapScene, size: Size) {
    const positions = new Float32Array(mapScene.triangles.length * 9)
    const uvs = new Float32Array(mapScene.triangles.length * 6)
    let positionOffset = 0
    let uvOffset = 0

    for (const triangle of mapScene.triangles) {
      for (let index = 0; index < 3; index += 1) {
        const point = triangle.points[index]
        const uv = triangle.texturePoints[index]

        positions[positionOffset] = point.x
        positions[positionOffset + 1] = size.height - point.y
        positions[positionOffset + 2] = 0
        positionOffset += 3

        uvs[uvOffset] = uv.x
        uvs[uvOffset + 1] = uv.y
        uvOffset += 2
      }
    }

    this.setAttribute('position', positions, 3)
    this.setAttribute('uv', uvs, 2)
    this.geometry.setDrawRange(0, positions.length / 3)
  }

  private setAttribute(
    name: 'position' | 'uv',
    values: Float32Array,
    itemSize: number,
  ) {
    const currentAttribute = this.geometry.getAttribute(name)

    if (
      currentAttribute instanceof BufferAttribute &&
      currentAttribute.array instanceof Float32Array &&
      currentAttribute.array.length === values.length &&
      currentAttribute.itemSize === itemSize
    ) {
      currentAttribute.array.set(values)
      currentAttribute.needsUpdate = true
      return
    }

    const nextAttribute = new BufferAttribute(values, itemSize)
    nextAttribute.setUsage(DynamicDrawUsage)
    this.geometry.setAttribute(name, nextAttribute)
  }
}

export function createMapBasemapRenderer(canvas: HTMLCanvasElement) {
  if (
    typeof window === 'undefined' ||
    (typeof WebGLRenderingContext === 'undefined' &&
      typeof WebGL2RenderingContext === 'undefined')
  ) {
    return null
  }

  try {
    return new WebGlMapBasemapRenderer(canvas)
  } catch {
    return null
  }
}
