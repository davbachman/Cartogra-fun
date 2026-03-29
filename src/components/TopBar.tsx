import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  getProjectionDefinition,
  groupedProjectionRegistry,
  supportsProjectionVisualization,
} from '../lib/projections'
import { useAppStore } from '../lib/store'

type IconButtonProps = {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}

function IconButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: IconButtonProps) {
  const tooltipId = useId()
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const [tooltipPosition, setTooltipPosition] = useState({ left: 0, top: 0 })

  function updateTooltipPosition() {
    if (!anchorRef.current) {
      return
    }

    const rect = anchorRef.current.getBoundingClientRect()
    setTooltipPosition({
      left: rect.left + rect.width * 0.5,
      top: rect.bottom + 10,
    })
  }

  function showTooltip() {
    updateTooltipPosition()
    setTooltipOpen(true)
  }

  function hideTooltip() {
    setTooltipOpen(false)
  }

  useEffect(() => {
    if (!tooltipOpen) {
      return
    }

    const handleViewportChange = () => {
      updateTooltipPosition()
    }

    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)

    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [tooltipOpen])

  return (
    <>
      <span
        ref={anchorRef}
        className="icon-button-anchor"
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
      >
        <button
          type="button"
          className="icon-button"
          aria-label={label}
          aria-describedby={tooltipOpen ? tooltipId : undefined}
          aria-pressed={active}
          data-active={active}
          disabled={disabled}
          onClick={onClick}
          onFocus={showTooltip}
          onBlur={hideTooltip}
        >
          {children}
        </button>
      </span>
      {tooltipOpen && typeof document !== 'undefined'
        ? createPortal(
            <span
              id={tooltipId}
              className="floating-tooltip"
              role="tooltip"
              style={{
                left: `${tooltipPosition.left}px`,
                top: `${tooltipPosition.top}px`,
              }}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </>
  )
}

type TextButtonProps = {
  label: string
  active?: boolean
  disabled?: boolean
  toggle?: boolean
  className?: string
  onClick: () => void
}

function TextButton({
  label,
  active = false,
  disabled = false,
  toggle = false,
  className = '',
  onClick,
}: TextButtonProps) {
  return (
    <button
      type="button"
      className={`toolbar-text-button${className ? ` ${className}` : ''}`}
      aria-label={label}
      aria-pressed={toggle ? active : undefined}
      data-active={active}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function SelectIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4.5v15l4.6-4.3 3.8 4.8 2.2-1.7-3.8-4.7H19Z" />
    </svg>
  )
}

function GeodesicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5.5" cy="17.5" r="1.6" />
      <circle cx="18.5" cy="6.5" r="1.6" />
      <path d="M6.8 16.4c3.1-6.2 7.1-8.8 10.4-9.1" />
      <path d="M8.2 18.2c2.7-1.1 5.4-1.1 8.1 0" />
    </svg>
  )
}

function ProjectionRotateIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" />
      <path d="M4.5 12h15" />
      <path d="M12 4.5c2.2 2.1 3.3 4.5 3.3 7.5S14.2 17.4 12 19.5c-2.2-2.1-3.3-4.5-3.3-7.5S9.8 6.6 12 4.5Z" />
    </svg>
  )
}

function ProjectionVisualizationIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="8" cy="12" rx="3.8" ry="7" />
      <path d="M12.8 6.2h5.4v11.6h-5.4" />
      <path d="M12.8 6.2c2.1 1.5 3.2 3.4 3.2 5.8s-1.1 4.3-3.2 5.8" />
      <circle cx="5.2" cy="12" r="1.3" />
      <path d="M6.5 12h5.6" />
    </svg>
  )
}

function padDatePart(value: number) {
  return value.toString().padStart(2, '0')
}

function toLocalDateValue(timestampMs: number) {
  const date = new Date(timestampMs)

  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
}

function toLocalTimeValue(timestampMs: number) {
  const date = new Date(timestampMs)

  return `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}`
}

function mergeDateIntoTimestamp(timestampMs: number, dateValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number)

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null
  }

  const current = new Date(timestampMs)

  return new Date(
    year,
    month - 1,
    day,
    current.getHours(),
    current.getMinutes(),
    current.getSeconds(),
    0,
  ).getTime()
}

function mergeTimeIntoTimestamp(timestampMs: number, timeValue: string) {
  const [hours, minutes, seconds = '0'] = timeValue.split(':')
  const nextHours = Number(hours)
  const nextMinutes = Number(minutes)
  const nextSeconds = Number(seconds)

  if (
    !Number.isInteger(nextHours) ||
    !Number.isInteger(nextMinutes) ||
    !Number.isInteger(nextSeconds)
  ) {
    return null
  }

  const current = new Date(timestampMs)

  return new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate(),
    nextHours,
    nextMinutes,
    nextSeconds,
    0,
  ).getTime()
}

export function TopBar() {
  const activeTool = useAppStore((state) => state.activeTool)
  const fixProjection = useAppStore((state) => state.fixProjection)
  const activeProjectionId = useAppStore((state) => state.activeProjectionId)
  const showProjectionVisualization = useAppStore(
    (state) => state.showProjectionVisualization,
  )
  const showDayNight = useAppStore((state) => state.showDayNight)
  const dayNightFollowNow = useAppStore((state) => state.dayNightFollowNow)
  const dayNightManualTimestampMs = useAppStore(
    (state) => state.dayNightManualTimestampMs,
  )
  const dayNightTimestampMs = useAppStore((state) => state.dayNightTimestampMs)
  const setActiveTool = useAppStore((state) => state.setActiveTool)
  const toggleFixProjection = useAppStore((state) => state.toggleFixProjection)
  const setActiveProjection = useAppStore((state) => state.setActiveProjection)
  const resetGlobePose = useAppStore((state) => state.resetGlobePose)
  const toggleProjectionVisualization = useAppStore(
    (state) => state.toggleProjectionVisualization,
  )
  const toggleDayNight = useAppStore((state) => state.toggleDayNight)
  const setDayNightManualTimestamp = useAppStore(
    (state) => state.setDayNightManualTimestamp,
  )
  const setDayNightFollowNow = useAppStore((state) => state.setDayNightFollowNow)
  const activeProjection = getProjectionDefinition(activeProjectionId)
  const projectionVisualizationAvailable =
    supportsProjectionVisualization(activeProjection)
  const visibleTimestampMs = dayNightFollowNow
    ? dayNightTimestampMs
    : dayNightManualTimestampMs

  function handleDateChange(event: ChangeEvent<HTMLInputElement>) {
    const nextTimestampMs = mergeDateIntoTimestamp(
      dayNightManualTimestampMs,
      event.target.value,
    )

    if (nextTimestampMs !== null) {
      setDayNightManualTimestamp(nextTimestampMs)
    }
  }

  function handleTimeChange(event: ChangeEvent<HTMLInputElement>) {
    const nextTimestampMs = mergeTimeIntoTimestamp(
      dayNightManualTimestampMs,
      event.target.value,
    )

    if (nextTimestampMs !== null) {
      setDayNightManualTimestamp(nextTimestampMs)
    }
  }

  return (
    <header className="top-bar">
      <div className="brand-block">
        <h1>Cartogra-fun</h1>
      </div>

      <label className="projection-select">
        <span>Projection</span>
        <select
          aria-label="Projection"
          value={activeProjectionId}
          onChange={(event) => setActiveProjection(event.target.value)}
        >
          {groupedProjectionRegistry.map((group) => (
            <optgroup key={group.family} label={group.family}>
              {group.projections.map((projection) => (
                <option key={projection.id} value={projection.id}>
                  {projection.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <div className="top-bar-controls-rail">
        <div className="top-bar-controls" role="toolbar" aria-label="Map controls">
          <TextButton
            label="Reset"
            className="top-bar-reset"
            onClick={resetGlobePose}
          />

          <div className="toolbar-group top-bar-pane-group" aria-label="Projection tools">
            <IconButton
              label="Fix Projection Map"
              active={fixProjection}
              onClick={toggleFixProjection}
            >
              <ProjectionRotateIcon />
            </IconButton>
            <IconButton
              label="Show Projection Surface"
              active={
                projectionVisualizationAvailable && showProjectionVisualization
              }
              disabled={!projectionVisualizationAvailable}
              onClick={toggleProjectionVisualization}
            >
              <ProjectionVisualizationIcon />
            </IconButton>
          </div>

          <div className="top-bar-switch-anchor">
            <div className="toolbar-switch top-bar-switch" aria-label="Interaction tools">
              <IconButton
                label="Select Point"
                active={activeTool === 'select'}
                onClick={() => setActiveTool('select')}
              >
                <SelectIcon />
              </IconButton>
              <IconButton
                label="Geodesic"
                active={activeTool === 'geodesic'}
                onClick={() => setActiveTool('geodesic')}
              >
                <GeodesicIcon />
              </IconButton>
            </div>
          </div>

          <div className="top-bar-day-night-wrap">
            <TextButton
              label="Day/night"
              active={showDayNight}
              className="top-bar-day-night"
              toggle
              onClick={toggleDayNight}
            />

            {showDayNight ? (
              <div
                className="toolbar-menu top-bar-day-night-panel"
                role="group"
                aria-label="Day and night settings"
              >
                <label className="day-night-field">
                  <span>Date</span>
                  <input
                    aria-label="Day/night date"
                    type="date"
                    value={toLocalDateValue(visibleTimestampMs)}
                    disabled={dayNightFollowNow}
                    onChange={handleDateChange}
                  />
                </label>
                <label className="day-night-field">
                  <span>Time</span>
                  <input
                    aria-label="Day/night time"
                    type="time"
                    step={1}
                    value={toLocalTimeValue(visibleTimestampMs)}
                    disabled={dayNightFollowNow}
                    onChange={handleTimeChange}
                  />
                </label>
                <label className="day-night-checkbox">
                  <input
                    aria-label="now"
                    type="checkbox"
                    checked={dayNightFollowNow}
                    onChange={(event) =>
                      setDayNightFollowNow(event.target.checked, Date.now())
                    }
                  />
                  <span>now</span>
                </label>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  )
}
