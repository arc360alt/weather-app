import { useRef, useState } from 'react'
import { useSettings }   from './hooks/useSettings'
import { useWeather }    from './hooks/useWeather'
import { useAlerts }     from './hooks/useAlerts'
import Map               from './components/Map'
import WeatherPanel      from './components/WeatherPanel'
import SettingsPanel     from './components/SettingsPanel'
import RadarControls     from './components/RadarControls'
import RadarLegend       from './components/RadarLegend'
import './app.css'

export default function App() {
  const [settings, updateSettings, resetSettings] = useSettings()
  const { data: weatherData, loading, error, refresh } = useWeather(settings.lat, settings.lon, settings.units)
  const { alerts }                                = useAlerts(settings.lat, settings.lon)

  const [radarFrames,  setRadarFrames]  = useState([])
  const [radarIndex,   setRadarIndex]   = useState(0)
  const [radarPlaying, setRadarPlaying] = useState(false)
  const [panelOpen,    setPanelOpen]    = useState(false)   // mobile collapse state
  const radarControls = useRef({})

  const handleMapClick = (lat, lon) => {
    updateSettings({ lat, lon, locationName: `${lat.toFixed(3)}, ${lon.toFixed(3)}` })
  }

  const handleFramesChange = (frames, idx) => {
    setRadarFrames(frames)
    setRadarIndex(idx)
  }

  const handleSeek = (idx) => {
    setRadarIndex(idx)
    radarControls.current.seek?.(idx)
  }

  const handleTogglePlay = () => {
    radarControls.current.togglePlay?.()
  }

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

      {/* Radar legend — shown when radar layer is active */}
      {settings.weatherLayer === 'radar' && (
        <RadarLegend />
      )}

      {/* Mobile panel toggle button */}
      <button
        className={`mobile-panel-toggle${panelOpen ? ' panel-is-open' : ''}`}
        onClick={() => setPanelOpen(o => !o)}
        aria-label={panelOpen ? 'Hide forecast' : 'Show forecast'}
      >
        {panelOpen
          ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
          : <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
              <span>Forecast</span>
            </>
        }
      </button>

      <div className={`panel-container ${panelLeft ? 'panel-left' : 'panel-right'} ${panelOpen ? 'panel-mobile-open' : ''}`}>
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

    </div>
  )
}