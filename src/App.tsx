import { useEffect } from 'react'
import { GlobePane } from './components/GlobePane'
import { MapPane } from './components/MapPane'
import { TopBar } from './components/TopBar'
import { getProjectionDefinition } from './lib/projections'
import { useAppStore } from './lib/store'

function App() {
  const activeProjectionId = useAppStore((state) => state.activeProjectionId)
  const showDayNight = useAppStore((state) => state.showDayNight)
  const dayNightFollowNow = useAppStore((state) => state.dayNightFollowNow)
  const tickDayNightClock = useAppStore((state) => state.tickDayNightClock)
  const activeProjection = getProjectionDefinition(activeProjectionId)

  useEffect(() => {
    if (!showDayNight || !dayNightFollowNow) {
      return
    }

    tickDayNightClock(Date.now())
    const intervalId = window.setInterval(() => {
      tickDayNightClock(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [dayNightFollowNow, showDayNight, tickDayNightClock])

  return (
    <div className="app-shell">
      <TopBar />

      <main className="workspace">
        <GlobePane />
        <MapPane projection={activeProjection} />
      </main>
    </div>
  )
}

export default App
