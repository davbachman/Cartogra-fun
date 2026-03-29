import { useSyncExternalStore } from 'react'
import {
  getDaylightBlendFactorFromCosineSolarZenith,
  getSolarCoordinates,
} from './dayNight'
import { degToRad } from './math'

type TextureLoadState = 'idle' | 'loading' | 'ready' | 'error'

export type EarthTextureRequest = {
  showDayNight?: boolean
  timestampMs?: number
}

type TextureState = {
  canvas: HTMLCanvasElement | null
  fillPlaceholder: (
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
  ) => void
  height: number
  loadState: TextureLoadState
  pixels: Uint8ClampedArray | null
  url: string
  width: number
}

const DAY_TEXTURE_URL = `${import.meta.env.BASE_URL}textures/earth_day.jpg`
const NIGHT_TEXTURE_URL = `${import.meta.env.BASE_URL}textures/earth_night.jpg`
const FALLBACK_WIDTH = 1000
const FALLBACK_HEIGHT = 500
const listeners = new Set<() => void>()
const defaultRequest = Object.freeze({
  showDayNight: false,
  timestampMs: 0,
}) satisfies Required<EarthTextureRequest>

let textureVersion = 0
let compositeCanvas: HTMLCanvasElement | null = null
let compositeFingerprint = ''

function createTextureState(
  url: string,
  fillPlaceholder: TextureState['fillPlaceholder'],
): TextureState {
  return {
    canvas: null,
    fillPlaceholder,
    height: FALLBACK_HEIGHT,
    loadState: 'idle',
    pixels: null,
    url,
    width: FALLBACK_WIDTH,
  }
}

const dayTexture = createTextureState(DAY_TEXTURE_URL, fillDayPlaceholder)
const nightTexture = createTextureState(NIGHT_TEXTURE_URL, fillNightPlaceholder)

function notifyTextureUpdate() {
  textureVersion += 1

  for (const listener of listeners) {
    listener()
  }
}

function fillDayPlaceholder(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const oceanGradient = context.createLinearGradient(0, 0, 0, height)
  oceanGradient.addColorStop(0, '#21425c')
  oceanGradient.addColorStop(0.34, '#2f7aa2')
  oceanGradient.addColorStop(0.66, '#246a93')
  oceanGradient.addColorStop(1, '#17344f')
  context.fillStyle = oceanGradient
  context.fillRect(0, 0, width, height)
}

function fillNightPlaceholder(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const skyGradient = context.createLinearGradient(0, 0, 0, height)
  skyGradient.addColorStop(0, '#08111a')
  skyGradient.addColorStop(0.5, '#0c1824')
  skyGradient.addColorStop(1, '#101f2c')
  context.fillStyle = skyGradient
  context.fillRect(0, 0, width, height)

  context.fillStyle = 'rgba(255, 205, 124, 0.24)'

  for (let index = 0; index < 220; index += 1) {
    const x = ((index * 71) % width) + 0.5
    const y = ((index * 43) % height) + 0.5
    const radius = (index % 4) * 0.35 + 0.3

    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()
  }
}

function getCanvasContext(canvas: HTMLCanvasElement) {
  return canvas.getContext('2d', { willReadFrequently: true })
}

function rebuildPixelCache(
  textureState: TextureState,
  context: CanvasRenderingContext2D,
) {
  if (!textureState.canvas || typeof context.getImageData !== 'function') {
    textureState.pixels = null
    return
  }

  const imageData = context.getImageData(
    0,
    0,
    textureState.canvas.width,
    textureState.canvas.height,
  )

  textureState.pixels = imageData.data
  textureState.width = textureState.canvas.width
  textureState.height = textureState.canvas.height
}

function ensureTextureCanvas(textureState: TextureState) {
  if (textureState.canvas || typeof document === 'undefined') {
    return
  }

  textureState.canvas = document.createElement('canvas')
  textureState.canvas.width = textureState.width
  textureState.canvas.height = textureState.height

  const context = getCanvasContext(textureState.canvas)

  if (!context) {
    return
  }

  textureState.fillPlaceholder(context, textureState.canvas.width, textureState.canvas.height)
  rebuildPixelCache(textureState, context)
}

function ensureTextureLoaded(textureState: TextureState) {
  ensureTextureCanvas(textureState)

  if (
    textureState.loadState !== 'idle' ||
    typeof Image === 'undefined' ||
    !textureState.canvas
  ) {
    return
  }

  textureState.loadState = 'loading'

  const image = new Image()
  image.decoding = 'async'

  image.onload = () => {
    if (!textureState.canvas) {
      textureState.loadState = 'error'
      notifyTextureUpdate()
      return
    }

    textureState.canvas.width =
      image.naturalWidth || image.width || FALLBACK_WIDTH
    textureState.canvas.height =
      image.naturalHeight || image.height || FALLBACK_HEIGHT

    const context = getCanvasContext(textureState.canvas)

    if (!context) {
      textureState.loadState = 'error'
      notifyTextureUpdate()
      return
    }

    context.clearRect(0, 0, textureState.canvas.width, textureState.canvas.height)
    context.drawImage(image, 0, 0, textureState.canvas.width, textureState.canvas.height)
    rebuildPixelCache(textureState, context)
    textureState.loadState = 'ready'
    compositeFingerprint = ''
    notifyTextureUpdate()
  }

  image.onerror = () => {
    textureState.loadState = 'error'
    notifyTextureUpdate()
  }

  image.src = textureState.url
}

function ensureBaseTexturesLoaded() {
  ensureTextureLoaded(dayTexture)
  ensureTextureLoaded(nightTexture)
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

function ensureCompositeCanvas() {
  if (compositeCanvas || typeof document === 'undefined') {
    return
  }

  compositeCanvas = document.createElement('canvas')
  compositeCanvas.width = FALLBACK_WIDTH
  compositeCanvas.height = FALLBACK_HEIGHT
}

function getFallbackCanvas() {
  if (typeof document === 'undefined') {
    throw new Error('Earth texture canvas requires a browser document')
  }

  const fallbackCanvas = document.createElement('canvas')
  fallbackCanvas.width = 1
  fallbackCanvas.height = 1

  return fallbackCanvas
}

function normalizeRequest(
  request: EarthTextureRequest = defaultRequest,
): Required<EarthTextureRequest> {
  return {
    showDayNight: request.showDayNight ?? false,
    timestampMs: request.timestampMs ?? 0,
  }
}

function renderCompositeTexture(request: Required<EarthTextureRequest>) {
  ensureCompositeCanvas()

  if (!compositeCanvas || !dayTexture.canvas || !dayTexture.pixels) {
    return dayTexture.canvas ?? getFallbackCanvas()
  }

  const targetWidth = dayTexture.width
  const targetHeight = dayTexture.height

  if (
    compositeCanvas.width !== targetWidth ||
    compositeCanvas.height !== targetHeight
  ) {
    compositeCanvas.width = targetWidth
    compositeCanvas.height = targetHeight
  }

  const fingerprint = `${request.showDayNight}:${request.timestampMs}:${targetWidth}x${targetHeight}:${nightTexture.width}x${nightTexture.height}:${textureVersion}`

  if (compositeFingerprint === fingerprint) {
    return compositeCanvas
  }

  const context = getCanvasContext(compositeCanvas)

  if (!context) {
    return dayTexture.canvas
  }

  if (!request.showDayNight || !nightTexture.pixels) {
    context.clearRect(0, 0, targetWidth, targetHeight)
    context.drawImage(dayTexture.canvas, 0, 0, targetWidth, targetHeight)
    compositeFingerprint = fingerprint
    return compositeCanvas
  }

  const solarCoordinates = getSolarCoordinates(request.timestampMs)
  const sunLatitudeSin = Math.sin(solarCoordinates.declinationRad)
  const sunLatitudeCos = Math.cos(solarCoordinates.declinationRad)
  const imageData = context.createImageData(targetWidth, targetHeight)
  const pixels = imageData.data

  for (let y = 0; y < targetHeight; y += 1) {
    const latitudeRad = degToRad(90 - ((y + 0.5) / targetHeight) * 180)
    const latitudeSin = Math.sin(latitudeRad)
    const latitudeCos = Math.cos(latitudeRad)

    for (let x = 0; x < targetWidth; x += 1) {
      const longitudeRad = degToRad(((x + 0.5) / targetWidth) * 360 - 180)
      const cosineSolarZenith =
        latitudeSin * sunLatitudeSin +
        latitudeCos *
          sunLatitudeCos *
          Math.cos(longitudeRad - solarCoordinates.subsolarLonRad)
      const blend = getDaylightBlendFactorFromCosineSolarZenith(
        cosineSolarZenith,
      )
      const offset = (y * targetWidth + x) * 4

      pixels[offset] =
        nightTexture.pixels[offset] * (1 - blend) + dayTexture.pixels[offset] * blend
      pixels[offset + 1] =
        nightTexture.pixels[offset + 1] * (1 - blend) +
        dayTexture.pixels[offset + 1] * blend
      pixels[offset + 2] =
        nightTexture.pixels[offset + 2] * (1 - blend) +
        dayTexture.pixels[offset + 2] * blend
      pixels[offset + 3] = 255
    }
  }

  context.putImageData(imageData, 0, 0)
  compositeFingerprint = fingerprint

  return compositeCanvas
}

export function getEarthTextureCanvas(request: EarthTextureRequest = defaultRequest) {
  ensureBaseTexturesLoaded()

  const normalizedRequest = normalizeRequest(request)

  if (!normalizedRequest.showDayNight) {
    return dayTexture.canvas ?? getFallbackCanvas()
  }

  return renderCompositeTexture(normalizedRequest)
}

export function useEarthTextureVersion() {
  ensureBaseTexturesLoaded()

  return useSyncExternalStore(subscribe, () => textureVersion, () => 0)
}
