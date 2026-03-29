import { useEffect, useState, type RefObject } from 'react'
import type { Size } from './types'

export function useElementSize(elementRef: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  useEffect(() => {
    const element = elementRef.current

    if (!element) {
      return
    }

    const updateSize = () => {
      const bounds = element.getBoundingClientRect()

      setSize({
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      })
    }

    updateSize()

    const observer = new ResizeObserver(updateSize)
    observer.observe(element)

    return () => observer.disconnect()
  }, [elementRef])

  return size
}
