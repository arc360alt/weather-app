import { useState, useEffect } from 'react'
import { MAP_STYLES, WEATHER_LAYERS, ANIMATION_SPEEDS } from '../config/defaults'

function Row({ label, children }) {
  return (
    <div className="settings-row">
      <label className="settings-label">{label}</label>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`toggle ${checked ? 'toggle-on' : 'toggle-off'}`}
    >
      <span className="toggle-thumb" />
    </button>
  )
}

/**
 * SettingsPanel now accepts optional external open control:
 *   externalOpen        — controlled open state (from App on mobile)
 *   onExternalOpenChange — callback when panel opens/closes internally
 *   onOpen              — called before opening, so App can close forecast panel
 */
export default function SettingsPanel({ settings, onUpdate, onReset, externalOpen, onExternalOpenChange, onOpen }) {
  const [open, setOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [gpsLoading, setGpsLoading] = useState(false)

  // Sync external open state → local
  useEffect(() => {
    if (externalOpen !== undefined) {
      setOpen(externalOpen)
    }
  }, [externalOpen])

  const openPanel = () => {
    onOpen?.()                    // let App close forecast first
    setOpen(true)
    onExternalOpenChange?.(true)
  }

  const closePanel = () => {
    setOpen(false)
    onExternalOpenChange?.(false)
  }

  const set = (key, value) => onUpdate({ [key]: value })

  // GPS auto-locate
  const handleGpsLocate = () => {
    if (!navigator.geolocation) {
      setSearchError('Geolocation is not supported by your browser.')
      return
    }
    setGpsLoading(true)
    setSearchError(null)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords
        // Reverse geocode with Nominatim to get a display name
        try {
          const resp = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
            { headers: { 'Accept-Language': 'en', 'User-Agent': 'WeatherApp/1.0' } }
          )
          const r = await resp.json()
          const addr = r.address ?? {}
          const parts = [
            addr.city || addr.town || addr.village || addr.county,
            addr.state,
          ].filter(Boolean)
          const locationName = parts.length > 0 ? parts.join(', ') : `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`
          onUpdate({ lat: latitude, lon: longitude, locationName })
        } catch {
          // If reverse geocode fails, just use coordinates
          onUpdate({
            lat: latitude,
            lon: longitude,
            locationName: `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`,
          })
        } finally {
          setGpsLoading(false)
        }
      },
      (err) => {
        setGpsLoading(false)
        const msgs = {
          1: 'Location access denied. Please allow location permission.',
          2: 'Location unavailable. Try searching manually.',
          3: 'Location request timed out.',
        }
        setSearchError(msgs[err.code] ?? 'Failed to get your location.')
      },
      { timeout: 10000, maximumAge: 60000 }
    )
  }

  // Geocode location using Nominatim (free, no key)
  const handleSearch = async (e) => {
    e.preventDefault()
    if (!searchInput.trim()) return
    setSearching(true)
    setSearchError(null)
    try {
      const isZip = /^\d{5}(-\d{4})?$/.test(searchInput.trim())
      const query = isZip ? `${searchInput.trim()} postal code USA` : searchInput.trim()
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`,
        { headers: { 'Accept-Language': 'en', 'User-Agent': 'WeatherApp/1.0' } }
      )
      const results = await resp.json()
      if (results.length === 0) {
        setSearchError('Location not found. Try a city name or full address.')
      } else {
        const r = results[0]
        const addr = r.address
        const parts = [
          addr.city || addr.town || addr.village || addr.county,
          addr.state,
          addr.country_code?.toUpperCase(),
        ].filter(Boolean)
        const locationName = isZip
          ? `${searchInput.trim()}, ${parts.slice(0, 2).join(', ')}`
          : parts.slice(0, 2).join(', ')
        onUpdate({
          lat: parseFloat(r.lat),
          lon: parseFloat(r.lon),
          locationName,
        })
        setSearchInput('')
      }
    } catch (err) {
      setSearchError('Search failed: ' + err.message)
    } finally {
      setSearching(false)
    }
  }

  return (
    <>
      {/* Gear Button */}
      <button
        onClick={openPanel}
        className="settings-btn"
        title="Settings"
        aria-label="Open settings"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {/* Backdrop */}
      {open && (
        <div className="settings-backdrop" onClick={closePanel} />
      )}

      {/* Panel */}
      <div className={`settings-panel ${open ? 'settings-panel-open' : ''}`}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button onClick={closePanel} className="close-btn" aria-label="Close">✕</button>
        </div>

        <div className="settings-body">

          {/* ── Location ── */}
          <section className="settings-section">
            <h3>Location</h3>
            <form onSubmit={handleSearch} className="search-form">
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Search city or address…"
                className="settings-input"
              />
              <button type="submit" disabled={searching} className="search-btn" title="Search">
                {searching ? '…' : '🔍'}
              </button>
              {/* GPS locate button */}
              <button
                type="button"
                className={`search-btn gps-btn ${gpsLoading ? 'gps-btn-loading' : ''}`}
                onClick={handleGpsLocate}
                disabled={gpsLoading}
                title="Use my current location"
                aria-label="Use GPS location"
              >
                {gpsLoading
                  ? <span className="gps-spinner" />
                  : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <circle cx="12" cy="12" r="3"/>
                      <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
                      <path d="M12 5a7 7 0 1 0 7 7"/>
                    </svg>
                  )
                }
              </button>
            </form>
            {searchError && <p className="settings-error">{searchError}</p>}
            {settings.locationName && (
              <p className="current-location-display">📍 {settings.locationName}</p>
            )}
            <p className="settings-hint">Search city or address. Click the map to drop a pin, or use GPS to auto-detect.</p>
          </section>

          {/* ── Map ── */}
          <section className="settings-section">
            <h3>Map</h3>
            <Row label="Style">
              <select
                className="settings-select"
                value={settings.mapStyle}
                onChange={e => set('mapStyle', e.target.value)}
              >
                {MAP_STYLES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Row>

            <Row label="Weather Layer">
              <select
                className="settings-select"
                value={settings.weatherLayer}
                onChange={e => set('weatherLayer', e.target.value)}
              >
                {WEATHER_LAYERS.map(l => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </Row>

            <Row label={`Opacity: ${Math.round(settings.layerOpacity * 100)}%`}>
              <input
                type="range" min="0" max="1" step="0.05"
                value={settings.layerOpacity}
                onChange={e => set('layerOpacity', parseFloat(e.target.value))}
                className="settings-range"
              />
            </Row>
          </section>

          {/* ── Radar ── */}
          <section className="settings-section">
            <h3>Radar Animation</h3>
            <Row label="Animate Radar">
              <Toggle checked={settings.animateRadar} onChange={v => set('animateRadar', v)} />
            </Row>
            {settings.animateRadar && (
              <Row label="Speed">
                <div className="btn-group">
                  {ANIMATION_SPEEDS.map(s => (
                    <button key={s.value}
                      className={`btn-option ${settings.animationSpeed === s.value ? 'active' : ''}`}
                      onClick={() => set('animationSpeed', s.value)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </Row>
            )}
          </section>

          {/* ── Units ── */}
          <section className="settings-section">
            <h3>Units</h3>
            <Row label="Temperature">
              <div className="btn-group">
                <button
                  className={`btn-option ${settings.units === 'metric' ? 'active' : ''}`}
                  onClick={() => set('units', 'metric')}
                >°C / km/h</button>
                <button
                  className={`btn-option ${settings.units === 'imperial' ? 'active' : ''}`}
                  onClick={() => set('units', 'imperial')}
                >°F / mph</button>
              </div>
            </Row>
          </section>

          {/* ── UI ── */}
          <section className="settings-section">
            <h3>Display</h3>
            <Row label="Panel Side">
              <div className="btn-group">
                <button
                  className={`btn-option ${settings.panelPosition === 'left' ? 'active' : ''}`}
                  onClick={() => set('panelPosition', 'left')}
                >Left</button>
                <button
                  className={`btn-option ${settings.panelPosition === 'right' ? 'active' : ''}`}
                  onClick={() => set('panelPosition', 'right')}
                >Right</button>
              </div>
            </Row>
            <Row label="Hourly Chart">
              <Toggle checked={settings.showHourlyChart} onChange={v => set('showHourlyChart', v)} />
            </Row>
            <Row label="7-Day Chart">
              <Toggle checked={settings.show7DayChart} onChange={v => set('show7DayChart', v)} />
            </Row>
            <Row label="Daily Forecast">
              <Toggle checked={settings.showDailyForecast} onChange={v => set('showDailyForecast', v)} />
            </Row>
          </section>

          {/* ── Reset ── */}
          <section className="settings-section">
            <button onClick={onReset} className="reset-btn">
              ↺ Reset to Defaults
            </button>
          </section>

        </div>
      </div>
    </>
  )
}
