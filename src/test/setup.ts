import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

class ResizeObserverMock {
  observe() {}

  unobserve() {}

  disconnect() {}
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverMock,
})

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false
    },
  }),
})

Object.defineProperty(window, 'requestAnimationFrame', {
  writable: true,
  value(callback: FrameRequestCallback) {
    return window.setTimeout(() => callback(performance.now()), 16)
  },
})

Object.defineProperty(window, 'cancelAnimationFrame', {
  writable: true,
  value(handle: number) {
    window.clearTimeout(handle)
  },
})

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  writable: true,
  value(contextId: string) {
    if (contextId !== '2d') {
      return {} as RenderingContext
    }

    return {
      arc() {},
      beginPath() {},
      clearRect() {},
      clip() {},
      closePath() {},
      createLinearGradient() {
        return { addColorStop() {} }
      },
      createRadialGradient() {
        return { addColorStop() {} }
      },
      drawImage() {},
      fill() {},
      fillRect() {},
      lineTo() {},
      moveTo() {},
      restore() {},
      save() {},
      setTransform() {},
      transform() {},
      stroke() {},
    } as unknown as CanvasRenderingContext2D
  },
})
