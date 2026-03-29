import { describe, expect, it } from 'vitest'
import { getDaylightBlendFactor, getSolarCoordinates } from './dayNight'

describe('day/night solar math', () => {
  it('keeps the subsolar latitude near the equator at the March equinox', () => {
    const solarCoordinates = getSolarCoordinates(
      Date.UTC(2026, 2, 20, 12, 0, 0),
    )

    expect(solarCoordinates.subsolarLatDeg).toBeGreaterThan(-1.5)
    expect(solarCoordinates.subsolarLatDeg).toBeLessThan(1.5)
    expect(solarCoordinates.subsolarLonDeg).toBeGreaterThanOrEqual(-5)
    expect(solarCoordinates.subsolarLonDeg).toBeLessThanOrEqual(5)
  })

  it('moves the subsolar latitude northward at the June solstice', () => {
    const solarCoordinates = getSolarCoordinates(
      Date.UTC(2026, 5, 21, 12, 0, 0),
    )

    expect(solarCoordinates.subsolarLatDeg).toBeGreaterThan(22)
    expect(solarCoordinates.subsolarLatDeg).toBeLessThan(24.5)
  })

  it('returns day on the sunward side and night on the anti-solar side', () => {
    const solarCoordinates = getSolarCoordinates(
      Date.UTC(2026, 2, 20, 12, 0, 0),
    )

    const daylightAtSubsolarPoint = getDaylightBlendFactor(
      {
        latDeg: solarCoordinates.subsolarLatDeg,
        lonDeg: solarCoordinates.subsolarLonDeg,
      },
      solarCoordinates,
    )
    const daylightOppositeTheSun = getDaylightBlendFactor(
      {
        latDeg: -solarCoordinates.subsolarLatDeg,
        lonDeg: solarCoordinates.subsolarLonDeg + 180,
      },
      solarCoordinates,
    )

    expect(daylightAtSubsolarPoint).toBeGreaterThan(0.98)
    expect(daylightOppositeTheSun).toBeLessThan(0.02)
  })

  it('does not keep both poles inside the transition band a week after the March equinox', () => {
    const solarCoordinates = getSolarCoordinates(
      Date.UTC(2026, 2, 27, 12, 0, 0),
    )

    expect(
      getDaylightBlendFactor(
        {
          latDeg: 90,
          lonDeg: 0,
        },
        solarCoordinates,
      ),
    ).toBeGreaterThan(0.95)
    expect(
      getDaylightBlendFactor(
        {
          latDeg: -90,
          lonDeg: 0,
        },
        solarCoordinates,
      ),
    ).toBeLessThan(0.2)
  })
})
