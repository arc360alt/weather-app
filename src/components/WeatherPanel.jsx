import { useState } from 'react'
import { WEATHER_CODES } from '../config/defaults'
import { HourlyChart, WeeklyChart } from './Charts'

function getWeatherInfo(code) {
  return WEATHER_CODES[code] ?? { label: 'Unknown', icon: '🌡️' }
}

function WindDirection(deg) {
  const dirs = ['N','NE','E','SE','S','SW','W','NW']
  return dirs[Math.round(deg / 45) % 8]
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatDay(isoString) {
  const d = new Date(isoString)
  const today = new Date()
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'short' })
}

// ─── Stat Tile ─────────────────────────────────────────────────────────────────
function StatTile({ icon, label, value }) {
  return (
    <div className="stat-tile">
      <span className="stat-icon">{icon}</span>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
      </div>
    </div>
  )
}

// ─── Daily Row ─────────────────────────────────────────────────────────────────
function DailyRow({ day, code, high, low, precipChance, units }) {
  const { icon, label } = getWeatherInfo(code)
  const tempUnit = units === 'imperial' ? '°F' : '°C'
  return (
    <div className="daily-row">
      <span className="daily-day">{day}</span>
      <span className="daily-icon" title={label}>{icon}</span>
      <span className="daily-precip">{precipChance}%💧</span>
      <span className="daily-temps">
        <span className="daily-high">{Math.round(high)}{tempUnit}</span>
        <span className="daily-low">{Math.round(low)}{tempUnit}</span>
      </span>
    </div>
  )
}

// ─── Main WeatherPanel ─────────────────────────────────────────────────────────
export default function WeatherPanel({ weatherData, loading, error, settings, locationName, onSettingsOpen }) {
  const [chartType, setChartType] = useState(settings.chartType ?? 'temperature')

  if (loading) {
    return (
      <aside className="weather-panel">
        <div className="loading-state">
          <div className="spinner" />
          <p>Loading weather…</p>
        </div>
      </aside>
    )
  }

  if (error || !weatherData) {
    return (
      <aside className="weather-panel">
        <div className="error-state">
          <span>⚠️</span>
          <p>Failed to load weather</p>
          <small>{error}</small>
        </div>
      </aside>
    )
  }

  const c = weatherData.current
  const uvIndex = weatherData.daily?.uv_index_max?.[0] ?? '—'
  const daily = weatherData.daily
  const units = settings.units
  const tempUnit = units === 'imperial' ? '°F' : '°C'
  const windUnit = units === 'imperial' ? 'mph' : 'km/h'
  const { icon, label } = getWeatherInfo(c.weather_code)

  return (
    <aside className="weather-panel">
      {/* Header / Current Conditions */}
      <div className="panel-header">
        <div className="location-name">{locationName ?? 'Current Location'}</div>
        <div className="current-main">
          <span className="current-icon">{icon}</span>
          <span className="current-temp">
            {Math.round(c.temperature_2m)}{tempUnit}
          </span>
        </div>
        <div className="current-description">{label}</div>
        <div className="feels-like">
          Feels like {Math.round(c.apparent_temperature)}{tempUnit}
        </div>
      </div>

      {/* Stat Grid */}
      <div className="stat-grid">
        <StatTile icon="💨" label="Wind"     value={`${Math.round(c.wind_speed_10m)} ${windUnit} ${WindDirection(c.wind_direction_10m)}`} />
        <StatTile icon="💧" label="Humidity" value={`${c.relative_humidity_2m}%`} />
        <StatTile icon="🌡️" label="Pressure" value={`${Math.round(c.surface_pressure)} hPa`} />
        <StatTile icon="☀️" label="UV Index"  value={uvIndex} />
        {daily?.sunrise?.[0] && <StatTile icon="🌅" label="Sunrise" value={formatTime(daily.sunrise[0])} />}
        {daily?.sunset?.[0]  && <StatTile icon="🌇" label="Sunset"  value={formatTime(daily.sunset[0])} />}
      </div>

      {/* Chart Type Tabs */}
      {settings.showHourlyChart && (
        <div className="chart-section">
          <div className="chart-tabs">
            {['temperature', 'precipitation', 'wind'].map(t => (
              <button key={t}
                className={`chart-tab ${chartType === t ? 'active' : ''}`}
                onClick={() => setChartType(t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <HourlyChart data={weatherData} units={units} chartType={chartType} />
        </div>
      )}

      {/* 7-Day Weekly Chart */}
      {settings.show7DayChart && (
        <div className="chart-section">
          <WeeklyChart data={weatherData} units={units} />
        </div>
      )}

      {/* 7-Day Forecast List */}
      {settings.showDailyForecast && daily && (
        <div className="daily-section">
          <h3 className="section-title">7-Day Forecast</h3>
          {daily.time.map((t, i) => (
            <DailyRow key={t}
              day={formatDay(t)}
              code={daily.weather_code[i]}
              high={daily.temperature_2m_max[i]}
              low={daily.temperature_2m_min[i]}
              precipChance={daily.precipitation_probability_max[i]}
              units={units}
            />
          ))}
        </div>
      )}
    </aside>
  )
}
