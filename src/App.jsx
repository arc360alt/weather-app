import { useRef, useState } from 'react'
import { useSettings }   from './hooks/useSettings'
import { useWeather }    from './hooks/useWeather'
import Map               from './components/Map'
import WeatherPanel      from './components/WeatherPanel'
import SettingsPanel     from './components/SettingsPanel'
import RadarControls     from './components/RadarControls'
import './app.css'

export default function App() {
  const [settings, updateSettings, resetSettings] = useSettings()
  const { data: weatherData, loading, error }     = useWeather(settings.lat, settings.lon, settings.units)

  const [radarFrames,  setRadarFrames]  = useState([])
  const [radarIndex,   setRadarIndex]   = useState(0)
  const [radarPlaying, setRadarPlaying] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Stable object — Map attaches .seek and .togglePlay to this once on mount
  const radarControls = useRef({})

  const handleMapClick = (lat, lon) => {
    updateSettings({ lat, lon, locationName: `${lat.toFixed(3)}, ${lon.toFixed(3)}` })
  }

const handleFramesChange = (frames, idx) => {
  console.log('handleFramesChange', frames.length, idx)
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
          onSettingsOpen={() => setSettingsOpen(true)}
        />
      </div>

      <div className={`settings-anchor ${panelLeft ? 'anchor-right' : 'anchor-left'}`}>
        <SettingsPanel
          settings={settings}
          onUpdate={updateSettings}
          onReset={resetSettings}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
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