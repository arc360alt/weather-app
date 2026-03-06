import { useRef, useState, useEffect, useCallback } from 'react'
import { useSettings }   from './hooks/useSettings'
import { useWeather }    from './hooks/useWeather'
import { useAlerts }     from './hooks/useAlerts'
import Map               from './components/Map'
import WeatherPanel      from './components/WeatherPanel'
import SettingsPanel     from './components/SettingsPanel'
import RadarControls     from './components/RadarControls'
import RadarLegend       from './components/RadarLegend'
import NewUpdateModal    from './components/NewUpdateModal'
import './app.css'

export default function App() {
  const [settings, updateSettings, resetSettings] = useSettings()
  const { data: weatherData, loading, error, refresh } = useWeather(settings.lat, settings.lon, settings.units, settings.weatherProvider, settings.owmApiKey)
  const { alerts } = useAlerts(settings.lat, settings.lon)

  const [radarFrames,  setRadarFrames]  = useState([])
  const [radarIndex,   setRadarIndex]   = useState(0)
  const [radarPlaying, setRadarPlaying] = useState(false)
  const [panelOpen,    setPanelOpen]    = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showChangelog, setShowChangelog] = useState(false)
  const radarControls = useRef({})

  // ── Drag-to-close ──────────────────────────────────────────────────────────
  const panelRef        = useRef(null)
  const drag            = useRef(null)
  const setPanelOpenRef = useRef(setPanelOpen)

  useEffect(() => {
    const el = panelRef.current
    if (!el) return

    function start(clientY) {
      const rect = el.getBoundingClientRect()
      if (clientY - rect.top > 48) return
      drag.current = { startY: clientY, startTime: Date.now(), committed: false }
      el.style.transition = 'none'
    }

    function move(clientY) {
      const d = drag.current
      if (!d) return
      const dy = clientY - d.startY
      if (!d.committed) {
        if (Math.abs(dy) < 6) return
        if (dy < 0) {
          drag.current = null
          el.style.transition = ''
          el.style.transform  = ''
          return
        }
        d.committed = true
      }
      el.style.transform = `translateY(${Math.max(0, dy)}px)`
    }

    function end(clientY) {
      const d = drag.current
      if (!d) return
      drag.current = null
      el.style.transition = ''
      el.style.transform  = ''
      if (!d.committed) return
      const dy  = clientY - d.startY
      const vel = dy / Math.max(1, Date.now() - d.startTime)
      if (dy > 80 || vel > 0.4) setPanelOpenRef.current(false)
    }

    function onTouchStart(e) { start(e.touches[0].clientY) }
    function onTouchMove(e)  {
      if (!drag.current) return
      if (drag.current.committed) e.preventDefault()
      move(e.touches[0].clientY)
    }
    function onTouchEnd(e)   { end(e.changedTouches[0].clientY) }

    function onMouseDown(e)  { document.body.classList.add('no-select'); start(e.clientY) }
    function onMouseMove(e)  { if (drag.current) move(e.clientY) }
    function onMouseUp(e)    { document.body.classList.remove('no-select'); if (drag.current) end(e.clientY) }

    el.addEventListener('touchstart',    onTouchStart, { passive: true  })
    el.addEventListener('touchmove',     onTouchMove,  { passive: false })
    el.addEventListener('touchend',      onTouchEnd,   { passive: true  })
    el.addEventListener('mousedown',     onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)

    return () => {
      el.removeEventListener('touchstart',    onTouchStart)
      el.removeEventListener('touchmove',     onTouchMove)
      el.removeEventListener('touchend',      onTouchEnd)
      el.removeEventListener('mousedown',     onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',   onMouseUp)
    }
  }, [])

  // ── Mutual close on mobile ─────────────────────────────────────────────────
  const openPanel = useCallback(() => {
    setSettingsOpen(false)
    setPanelOpen(true)
  }, [])

  const openSettings = useCallback(() => {
    setPanelOpen(false)
    setSettingsOpen(true)
  }, [])

  const handleMapClick     = (lat, lon) => updateSettings({ lat, lon, locationName: `${lat.toFixed(3)}, ${lon.toFixed(3)}` })
  const handleFramesChange = (frames, idx) => { setRadarFrames(frames); setRadarIndex(idx) }
  const handleSeek         = (idx) => { setRadarIndex(idx); radarControls.current.seek?.(idx) }
  const handleTogglePlay   = () => radarControls.current.togglePlay?.()
  const handleTogglePanel  = () => panelOpen ? setPanelOpen(false) : openPanel()

  const panelLeft    = settings.panelPosition !== 'right'
  const showRadarBar = settings.weatherLayer === 'radar' && radarFrames.length > 0

  return (
    <div className={`app-root${panelLeft ? '' : ' panel-on-right'}`}>

      <div className="map-container">
        <Map
          settings={settings}
          onMapClick={handleMapClick}
          onFramesChange={handleFramesChange}
          onPlayingChange={setRadarPlaying}
          radarControls={radarControls.current}
        />
      </div>

      {settings.weatherLayer === 'radar' && <RadarLegend />}

      <button
        className="mobile-panel-toggle"
        onClick={handleTogglePanel}
        aria-label="Toggle forecast"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M3 12h18M3 6h18M3 18h18"/>
        </svg>
        <span>Forecast</span>
      </button>

      <div
        ref={panelRef}
        className={`panel-container ${panelLeft ? 'panel-left' : 'panel-right'} ${panelOpen ? 'panel-mobile-open' : ''}`}
      >
        <WeatherPanel
          weatherData={weatherData}
          loading={loading}
          error={error}
          settings={settings}
          locationName={settings.locationName}
          alerts={alerts}
          onRefresh={refresh}
        />
      </div>

      <div className={`settings-anchor ${panelLeft ? 'anchor-right' : 'anchor-left'}`}>
        <SettingsPanel
          settings={settings}
          onUpdate={updateSettings}
          onReset={resetSettings}
          externalOpen={settingsOpen}
          onExternalOpenChange={setSettingsOpen}
          onOpen={openSettings}
          onShowChangelog={() => setShowChangelog(true)}
        />
      </div>

      {showRadarBar && (
        <RadarControls
          frames={radarFrames}
          currentIndex={radarIndex}
          playing={radarPlaying}
          onSeek={handleSeek}
          onTogglePlay={handleTogglePlay}
        />
      )}

      <NewUpdateModal forceOpen={showChangelog} onForceClose={() => setShowChangelog(false)} />

    </div>
  )
}