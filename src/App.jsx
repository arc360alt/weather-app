import { useRef, useState } from 'react'
import { useSettings }   from './hooks/useSettings'
import { useWeather }    from './hooks/useWeather'
import { useAlerts }     from './hooks/useAlerts'
import Map               from './components/Map'
import WeatherPanel      from './components/WeatherPanel'
import SettingsPanel     from './components/SettingsPanel'
import RadarControls     from './components/RadarControls'
import './app.css'

export default function App() {
  const [settings, updateSettings, resetSettings] = useSettings()
  const { data: weatherData, loading, error }     = useWeather(settings.lat, settings.lon, settings.units)
  const { alerts }                                = useAlerts(settings.lat, settings.lon)

  const [radarFrames,  setRadarFrames]  = useState([])
  const [radarIndex,   setRadarIndex]   = useState(0)
  const [radarPlaying, setRadarPlaying] = useState(false)
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
    <div className="app-root">

      <div className="map-container">
        <Map
          settings={settings}
          onMapClick={handleMapClick}
          onFramesChange={handleFramesChange}
          onPlayingChange={setRadarPlaying}
          radarControls={radarControls.current}
        />
      </div>

      <div className={`panel-container ${panelLeft ? 'panel-left' : 'panel-right'}`}>
        <WeatherPanel
          weatherData={weatherData}
          loading={loading}
          error={error}
          settings={settings}
          locationName={settings.locationName}
          alerts={alerts}
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