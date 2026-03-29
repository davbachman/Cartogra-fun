import type { DistortionMetrics } from '../lib/indicatrix'
import type { SelectionSource } from '../lib/types'

type IndicatrixMetricsProps = {
  pane: SelectionSource
  source: SelectionSource | null
  metrics: DistortionMetrics | null
  message?: string
}

function formatFactor(value: number) {
  if (!Number.isFinite(value)) {
    return 'infinite'
  }

  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)}x`
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) {
    return 'infinite'
  }

  return value.toFixed(3)
}

export function IndicatrixMetrics({
  pane,
  source,
  metrics,
  message,
}: IndicatrixMetricsProps) {
  if (!source || source === pane) {
    return null
  }

  const title =
    source === 'globe' ? 'Image of selected globe circle' : 'Pre-image of selected map circle'

  return (
    <div className="pane-metrics-overlay" role="status" aria-live="polite">
      <div className="pane-metrics-header">
        <span className="pane-metrics-kicker">
          {source === 'globe' ? 'Image metrics' : 'Pre-image metrics'}
        </span>
        <span className="pane-metrics-title">{title}</span>
      </div>

      {metrics ? (
        <div className="pane-metrics-grid">
          <div className="pane-metrics-item">
            <span className="pane-metrics-label">Area factor</span>
            <strong className="pane-metrics-value">{formatFactor(metrics.areaFactor)}</strong>
          </div>
          <div className="pane-metrics-item">
            <span className="pane-metrics-label">Principal scales</span>
            <strong className="pane-metrics-value">
              {formatFactor(metrics.majorScale)} / {formatFactor(metrics.minorScale)}
            </strong>
          </div>
          <div className="pane-metrics-item">
            <span className="pane-metrics-label">Eccentricity</span>
            <strong className="pane-metrics-value">{formatNumber(metrics.eccentricity)}</strong>
          </div>
          <div className="pane-metrics-item">
            <span className="pane-metrics-label">Angular distortion</span>
            <strong className="pane-metrics-value">
              {metrics.angularDistortionDeg.toFixed(1)}°
            </strong>
          </div>
        </div>
      ) : (
        <p className="pane-metrics-message">
          {message ??
            (source === 'globe'
              ? 'The selected point is clipped by the current projection frame.'
              : 'The inverse patch becomes too large to render cleanly on the globe.')}
        </p>
      )}
    </div>
  )
}
