import { useState } from 'react'
import { WEATHER_CODES } from '../config/defaults'
import { HourlyChart, WeeklyChart } from './Charts'
import AlertBanner from './AlertBanner'

function getWeatherInfo(code) {
  return WEATHER_CODES[code] ?? { label: 'Unknown', icon: '🌡️' }
}

function windDir(deg) {
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
  if (d.toDateString() === today.toDateString())    return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'short' })
}

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

export default function WeatherPanel({ weatherData, loading, error, settings, locationName, alerts, onRefresh }) {
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
          {onRefresh && (
            <button className="refresh-btn" onClick={onRefresh}>
              ↺ Retry
            </button>
          )}
        </div>
      </aside>
    )
  }

  const c        = weatherData.current
  const daily    = weatherData.daily
  const units    = settings.units
  const tempUnit = units === 'imperial' ? '°F' : '°C'
  const windUnit = units === 'imperial' ? 'mph' : 'km/h'
  const uvIndex  = weatherData.daily?.uv_index_max?.[0] ?? '—'

  const { icon, label } = getWeatherInfo(c.weather_code)

  return (
    <aside className="weather-panel">

      {/* Active weather alerts */}
      {alerts && alerts.length > 0 && (
        <AlertBanner alerts={alerts} />
      )}

      {/* Current conditions header */}
      <div className="panel-header">
        <div className="panel-header-top">
          <div className="location-name">{locationName ?? 'Current Location'}</div>
          {onRefresh && (
            <button
              className="refresh-btn"
              onClick={onRefresh}
              title="Refresh weather data"
              aria-label="Refresh weather"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6"/>
                <path d="M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>
          )}
        </div>
        <div className="current-main">
          <span className="current-icon">{icon}</span>
          <span className="current-temp">{Math.round(c.temperature_2m)}{tempUnit}</span>
        </div>
        <div className="current-description">{label}</div>
        <div className="feels-like">Feels like {Math.round(c.apparent_temperature)}{tempUnit}</div>
      </div>

      {/* Stat grid */}
      <div className="stat-grid">
        <StatTile icon="💨" label="Wind"     value={`${Math.round(c.wind_speed_10m)} ${windUnit} ${windDir(c.wind_direction_10m)}`} />
        <StatTile icon="💧" label="Humidity" value={`${c.relative_humidity_2m}%`} />
        <StatTile icon="🌡️" label="Pressure" value={`${Math.round(c.surface_pressure)} hPa`} />
        <StatTile icon="☀️" label="UV Index" value={uvIndex} />
        {daily?.sunrise?.[0] && <StatTile icon="🌅" label="Sunrise" value={formatTime(daily.sunrise[0])} />}
        {daily?.sunset?.[0]  && <StatTile icon="🌇" label="Sunset"  value={formatTime(daily.sunset[0])} />}
      </div>

      {/* Hourly chart */}
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

      {/* 7-day chart */}
      {settings.show7DayChart && (
        <div className="chart-section">
          <WeeklyChart data={weatherData} units={units} />
        </div>
      )}

      {/* 7-day forecast list */}
      {settings.showDailyForecast && daily && (
        <div className="daily-section">
          <h3 className="section-title">7-Day Forecast</h3>
          {daily.time.map((t, i) => {
            const dayStart = new Date(t)
            dayStart.setHours(23, 59, 59, 999)
            if (dayStart < new Date()) return null   // skip past days
            return (
              <DailyRow key={t}
                day={formatDay(t)}
                code={daily.weather_code[i]}
                high={daily.temperature_2m_max[i]}
                low={daily.temperature_2m_min[i]}
                precipChance={daily.precipitation_probability_max[i]}
                units={units}
              />
            )
          })}
        </div>
      )}

    </aside>
  )
}
