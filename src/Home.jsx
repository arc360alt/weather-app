import { useState, useEffect, useCallback } from 'react'
import { useSettings } from './hooks/useSettings'
import { useWeather } from './hooks/useWeather'
import { useAlerts } from './hooks/useAlerts'
import { usePollen } from './hooks/usePollen'
import { useAirQuality, aqiInfo } from './hooks/useAirQuality'
import { useCloudCover } from './hooks/useCloudCover'
import { WEATHER_CODES } from './config/defaults'
import AlertModal from './components/AlertModal'
import WeatherAIPopup from './components/WeatherAIPopup'
import WeatherIcon, { toNightIcon } from './components/WeatherIcon'

// ── Helpers ────────────────────────────────────────────────────────────────

// Tiny inline icon for section titles and hero sub-stats
function SI({ name, size = 20 }) {
  return <WeatherIcon name={name} size={size} style={{ flexShrink: 0 }} />
}

function getWeatherInfo(code) {
  return WEATHER_CODES[code] ?? { label: 'Unknown', icon: 'thermometer' }
}

function isDaytime(isoString, daily) {
  if (!daily?.sunrise || !daily?.sunset) return true
  const t = new Date(isoString)
  const dateStr = isoString.split('T')[0]
  const dayIdx = daily.time.findIndex(d => d.split('T')[0] === dateStr)
  if (dayIdx === -1) return true
  const rise = daily.sunrise[dayIdx] ? new Date(daily.sunrise[dayIdx]) : null
  const set  = daily.sunset[dayIdx]  ? new Date(daily.sunset[dayIdx])  : null
  if (!rise || !set) return true
  return t >= rise && t <= set
}

function windDir(deg) {
  const dirs = ['N','NE','E','SE','S','SW','W','NW']
  return dirs[Math.round((deg ?? 0) / 45) % 8]
}

function formatTime(isoString) {
  if (!isoString) return '—'
  return new Date(isoString).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatDay(isoString) {
  if (!isoString) return '—'
  const [year, month, day] = isoString.split('T')[0].split('-').map(Number)
  const d = new Date(year, month - 1, day)
  const today = new Date(); today.setHours(0,0,0,0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatDayShort(isoString) {
  if (!isoString) return '—'
  const [year, month, day] = isoString.split('T')[0].split('-').map(Number)
  const d = new Date(year, month - 1, day)
  const today = new Date(); today.setHours(0,0,0,0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tmrw'
  return d.toLocaleDateString('en-US', { weekday: 'short' })
}

function formatHourShort(isoString) {
  const d = new Date(isoString)
  const h = d.getHours()
  if (h === 0)  return '12am'
  if (h === 12) return '12pm'
  return h > 12 ? `${h-12}pm` : `${h}am`
}

function uvLabel(uv) {
  if (uv == null) return '—'
  if (uv <= 2) return 'Low'
  if (uv <= 5) return 'Moderate'
  if (uv <= 7) return 'High'
  if (uv <= 10) return 'Very High'
  return 'Extreme'
}

function uvColor(uv) {
  if (uv == null) return '#6b8db5'
  if (uv <= 2) return '#22c55e'
  if (uv <= 5) return '#eab308'
  if (uv <= 7) return '#f97316'
  if (uv <= 10) return '#ef4444'
  return '#a855f7'
}

function pressureTrend(hpa) {
  if (!hpa) return ''
  if (hpa < 1000) return '↓ Low'
  if (hpa > 1020) return '↑ High'
  return '→ Normal'
}

function humidityLabel(rh) {
  if (rh == null) return '—'
  if (rh < 30) return 'Dry'
  if (rh < 60) return 'Comfortable'
  if (rh < 80) return 'Humid'
  return 'Very Humid'
}

// ── Desktop breakpoint hook ────────────────────────────────────────────────

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 900)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)')
    const handler = (e) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isDesktop
}

// ── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, subColor, accent }) {
  return (
    <div className="hm-stat-card" style={accent ? { borderLeftColor: accent, borderLeftWidth: 3, borderLeftStyle: 'solid' } : {}}>
      <div className="hm-stat-icon">{icon}</div>
      <div className="hm-stat-body">
        <div className="hm-stat-label">{label}</div>
        <div className="hm-stat-value">{value}</div>
        {sub && <div className="hm-stat-sub" style={subColor ? { color: subColor } : {}}>{sub}</div>}
      </div>
    </div>
  )
}

// ── Alert Banner ───────────────────────────────────────────────────────────

const SEVERITY_STYLES = {
  Extreme:  { bg: 'rgba(239,68,68,0.15)', border: '#ef4444', icon: '🚨', color: '#fca5a5' },
  Severe:   { bg: 'rgba(249,115,22,0.12)', border: '#f97316', icon: '⚠️', color: '#fdba74' },
  Moderate: { bg: 'rgba(234,179,8,0.12)', border: '#eab308', icon: '⚠️', color: '#fde047' },
  Minor:    { bg: 'rgba(59,130,246,0.12)', border: '#3b82f6', icon: 'ℹ️', color: '#93c5fd' },
  Unknown:  { bg: 'rgba(30,48,80,0.4)', border: '#1e3050', icon: 'ℹ️', color: '#6b8db5' },
}

function AlertStrip({ alerts, onAlertClick }) {
  if (!alerts || alerts.length === 0) return null
  const top = alerts[0]
  const p = top.properties
  const sev = p.severity ?? 'Unknown'
  const st = SEVERITY_STYLES[sev] ?? SEVERITY_STYLES.Unknown
  return (
    <div className="hm-alert-strip" style={{ background: st.bg, borderColor: st.border }}>
      <span>{st.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span className="hm-alert-event" style={{ color: st.color }}>{p.event ?? 'Alert'}</span>
        {p.headline && <span className="hm-alert-headline"> — {p.headline}</span>}
      </div>
      {alerts.length > 1 && <span className="hm-alert-count">+{alerts.length - 1}</span>}
      <button
        className="hm-alert-details-btn"
        onClick={() => onAlertClick(top)}
        aria-label="View alert details"
      >
        Details →
      </button>
    </div>
  )
}

// ── Radar Mini ─────────────────────────────────────────────────────────────

function RadarMini({ lat, lon, onOpenRadar, style }) {
  const [rvHost, setRvHost] = useState('')
  const [rvPath, setRvPath] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch('https://stormcastapi.arc360hub.com/public/weather-maps.json')
      .then(r => r.json())
      .then(json => {
        const host = json.host
        const frames = json.radar?.past ?? []
        if (frames.length) {
          const last = frames[frames.length - 1]
          setRvHost(host)
          setRvPath(last.path)
        }
      })
      .catch(() => {})
  }, [])

  const z = 7
  const x = Math.floor((lon + 180) / 360 * Math.pow(2, z))
  const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI/180) + 1/Math.cos(lat * Math.PI/180)) / Math.PI) / 2 * Math.pow(2, z))

  const mapTile = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
  const radarTile = rvHost && rvPath
    ? `${rvHost}${rvPath}/512/${z}/${x}/${y}/6/1_1.png`
    : null

  return (
    <button className="hm-radar-mini" onClick={onOpenRadar} aria-label="Open full radar" style={style}>
      <div className="hm-radar-map-wrap">
        <img src={mapTile} className="hm-radar-base" onLoad={() => setLoaded(true)} alt="" draggable={false} />
        {radarTile && loaded && (
          <img src={radarTile} className="hm-radar-overlay" alt="" draggable={false} />
        )}
        <div className="hm-radar-pin">📍</div>
        <div className="hm-radar-label-bar">Tap to open full radar →</div>
      </div>
    </button>
  )
}

// ── Hourly Scroll ──────────────────────────────────────────────────────────

// FIND: the entire HourlyRow function
// REPLACE WITH:

function HourlyRow({ hourly, units, daily }) {
  const { time, temperature_2m, precipitation_probability, weather_code } = hourly
  const tempUnit = units === 'imperial' ? '°F' : '°C'
  const now = new Date()
  const startIdx = Math.max(0, time.findIndex(t => new Date(t) >= now))
  const slice = time.slice(startIdx, startIdx + 24)
  const temps = temperature_2m.slice(startIdx, startIdx + 24)
  const probs = precipitation_probability.slice(startIdx, startIdx + 24)
  const codes = weather_code.slice(startIdx, startIdx + 24)

  return (
    <div className="hm-hourly-scroll">
      {slice.map((t, i) => {
        const { icon: baseIcon } = getWeatherInfo(codes[i])
        const icon = isDaytime(t, daily) ? baseIcon : toNightIcon(baseIcon)
        return (
          <div key={t} className="hm-hourly-item">
              <div className="hm-hourly-time">
                {i === 0 ? 'Now' : formatHourShort(t)}
                {i !== 0 && (() => {
                  const thisDay = new Date(t).getDate()
                  const prevDay = new Date(slice[i - 1]).getDate()
                  const today = new Date().getDate()
                  const tomorrow = new Date(Date.now() + 86400000).getDate()
                  if (thisDay !== prevDay) {
                    const label = thisDay === today ? 'Today'
                      : thisDay === tomorrow ? 'Tmrw'
                      : new Date(t).toLocaleDateString('en-US', { weekday: 'short' })
                    return <div className="hm-hourly-day-label">{label}</div>
                  }
                  return null
                })()}
              </div>
            <div className="hm-hourly-icon"><WeatherIcon name={icon} size={28} /></div>
            <div className="hm-hourly-temp">{Math.round(temps[i])}{tempUnit}</div>
            {probs[i] > 10 && <div className="hm-hourly-precip"><SI name="raindrop" size={10}/>{probs[i]}%</div>}
          </div>
        )
      })}
    </div>
  )
}

// ── 7-Day Forecast ─────────────────────────────────────────────────────────

function DailyForecast({ daily, units, isDesktop, onDayClick }) {
  const tempUnit = units === 'imperial' ? '°F' : '°C'
  const today = new Date(); today.setHours(0,0,0,0)
  const allMaxes = daily.temperature_2m_max.filter(Boolean)
  const allMins = daily.temperature_2m_min.filter(Boolean)
  const absMax = Math.max(...allMaxes)
  const absMin = Math.min(...allMins)
  const range = absMax - absMin || 1

  const days = daily.time.reduce((acc, t, i) => {
    const [y, m, d] = t.split('T')[0].split('-').map(Number)
    const day = new Date(y, m-1, d); day.setHours(0,0,0,0)
    if (day >= today) acc.push(i)
    return acc
  }, []).slice(0, 7)

  const inner = (
    <div className="hm-daily-list">
      {days.map(i => {
        const t = daily.time[i]
        const { icon } = getWeatherInfo(daily.weather_code[i])
        const hi = Math.round(daily.temperature_2m_max[i])
        const lo = Math.round(daily.temperature_2m_min[i])
        const prob = daily.precipitation_probability_max?.[i] ?? 0
        const barLeft = ((lo - absMin) / range) * 100
        const barWidth = ((hi - lo) / range) * 100
        return (
          <div key={t} className="hm-daily-row hm-daily-row-clickable" onClick={() => onDayClick?.(i)}>
            <div className="hm-daily-day">{formatDayShort(t)}</div>
            <div className="hm-daily-icon"><WeatherIcon name={icon} size={32} /></div>
            {prob > 10 ? <div className="hm-daily-precip"><SI name="raindrop" size={12}/>{prob}%</div> : <div className="hm-daily-precip" />}
            <div className="hm-daily-temps">
              <span className="hm-daily-lo">{lo}{tempUnit}</span>
              <div className="hm-daily-bar-track">
                <div className="hm-daily-bar-fill" style={{ left: `${barLeft}%`, width: `${Math.max(barWidth, 8)}%` }} />
              </div>
              <span className="hm-daily-hi">{hi}{tempUnit}</span>
            </div>
            <div className="hm-daily-chevron">›</div>
          </div>
        )
      })}
    </div>
  )

  if (isDesktop) {
    return (
      <div className="hm-section" style={{ borderBottom: 'none' }}>
        <div className="hm-section-title"><SI name="cloudy" />7-Day Forecast</div>
        {inner}
      </div>
    )
  }

  return (
    <div className="hm-section">
      <div className="hm-section-title"><SI name="cloudy" />7-Day Forecast</div>
      {inner}
    </div>
  )
}

// ── Day Detail Popup ───────────────────────────────────────────────────────

function DayDetailPopup({ daily, hourly, dayIdx, units, onClose }) {
  if (dayIdx == null || !daily) return null

  const tempUnit = units === 'imperial' ? '°F' : '°C'
  const windUnit = units === 'imperial' ? 'mph' : 'km/h'
  const t = daily.time[dayIdx]
  const dateStr = t?.split('T')[0]
  const { icon, label } = getWeatherInfo(daily.weather_code[dayIdx])
  const hi = Math.round(daily.temperature_2m_max[dayIdx])
  const lo = Math.round(daily.temperature_2m_min[dayIdx])
  const prob    = daily.precipitation_probability_max?.[dayIdx] ?? 0
  const uv      = daily.uv_index_max?.[dayIdx] ?? null
  const rise    = daily.sunrise?.[dayIdx]
  const set     = daily.sunset?.[dayIdx]
  const precip  = daily.precipitation_sum?.[dayIdx]
  const windMax = daily.wind_speed_10m_max?.[dayIdx]

  const hourlyIndices = hourly
    ? hourly.time.reduce((acc, ht, i) => { if (ht.startsWith(dateStr)) acc.push(i); return acc }, [])
    : []

  const details = [
    uv      != null              && { label: 'UV Index',      val: `${uv} · ${uvLabel(uv)}`,                          color: uvColor(uv) },
    prob    > 0                  && { label: 'Rain Chance',   val: `${prob}%` },
    precip  != null && precip > 0 && { label: 'Precipitation', val: `${precip} ${units === 'imperial' ? 'in' : 'mm'}` },
    windMax != null              && { label: 'Wind Max',      val: `${Math.round(windMax)} ${windUnit}` },
    rise                         && { label: 'Sunrise',       val: formatTime(rise) },
    set                          && { label: 'Sunset',        val: formatTime(set) },
  ].filter(Boolean)

  return (
    <>
      <div className="ddp-overlay" onClick={onClose} />
      <div className="ddp-popup" role="dialog" aria-modal="true">
        <div className="ddp-header">
          <WeatherIcon name={icon} size={36} />
          <div className="ddp-header-info">
            <div className="ddp-date">{formatDay(dateStr + 'T12:00')}</div>
            <div className="ddp-condition">{label}</div>
          </div>
          <div className="ddp-hi-lo">
            <span className="ddp-hi">{hi}{tempUnit}</span>
            <span className="ddp-sep">/</span>
            <span className="ddp-lo">{lo}{tempUnit}</span>
          </div>
          <button className="ddp-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="ddp-body">
          {hourlyIndices.length > 0 && (
            <div className="ddp-section">
              <div className="ddp-section-title">Hourly Breakdown</div>
              <div className="ddp-hourly-scroll">
                {hourlyIndices.map(i => {
                  const ht = hourly.time[i]
                  const { icon: hIcon } = getWeatherInfo(hourly.weather_code[i])
                  const finalIcon = isDaytime(ht, daily) ? hIcon : toNightIcon(hIcon)
                  const hProb = hourly.precipitation_probability?.[i] ?? 0
                  const hWind = hourly.wind_speed_10m?.[i]
                  return (
                    <div key={ht} className="ddp-hour-item">
                      <div className="ddp-hour-time">{formatHourShort(ht)}</div>
                      <WeatherIcon name={finalIcon} size={26} />
                      <div className="ddp-hour-temp">{Math.round(hourly.temperature_2m[i])}{tempUnit}</div>
                      {hProb > 10 && <div className="ddp-hour-precip"><SI name="raindrop" size={9}/>{hProb}%</div>}
                      {hWind != null && <div className="ddp-hour-wind">{Math.round(hWind)}<span>{windUnit}</span></div>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {details.length > 0 && (
            <div className="ddp-section">
              <div className="ddp-section-title">Day Details</div>
              <div className="ddp-details-grid">
                {details.map(({ label: dl, val, color }) => (
                  <div key={dl} className="ddp-detail">
                    <div className="ddp-detail-label">{dl}</div>
                    <div className="ddp-detail-val" style={color ? { color } : {}}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Sun / Moon Block ───────────────────────────────────────────────────────

function SunMoonBlock({ daily }) {
  const rise = daily?.sunrise?.[0]
  const set  = daily?.sunset?.[0]
  const rise2 = daily?.sunrise?.[1]  // next day sunrise for night arc
  if (!rise && !set) return null

  const now = new Date()
  const riseD = rise ? new Date(rise) : null
  const setD  = set  ? new Date(set)  : null
  const rise2D = rise2 ? new Date(rise2) : null
  const dayLen = riseD && setD ? Math.round((setD - riseD) / 60000) : null

  // Sun progress 0–1 during day arc
  const dayProg = riseD && setD ? Math.max(0, Math.min(1, (now - riseD) / (setD - riseD))) : null
  // Night progress 0–1 after sunset until next sunrise
  const nightProg = setD && rise2D ? Math.max(0, Math.min(1, (now - setD) / (rise2D - setD))) : null
  const isDay = dayProg != null && dayProg >= 0 && dayProg <= 1 && now >= riseD && now <= setD

  // Arc math helper: maps 0–1 progress along a semicircle
  const arcPoint = (prog, cx, cy, rx, ry) => {
    // prog=0 → left (sunrise), prog=0.5 → top center (noon), prog=1 → right (sunset)
    const angle = Math.PI * (1 - prog)
    return {
      x: cx + rx * Math.cos(angle),
      y: cy - ry * Math.sin(angle)
    }
  }

  const W = 320, H = 130
  const cx = W / 2, cy = H - 20
  const dayRx = 128, dayRy = 88
  const nightRx = 128, nightRy = 44

  // Sun position on day arc
  const sunPos = isDay && dayProg != null
    ? arcPoint(dayProg, cx, cy, dayRx, dayRy)
    : null

  // Moon position on night arc (below baseline)
  const moonProg = !isDay && nightProg != null ? nightProg : null
  const moonPos = moonProg != null
    ? { x: cx - nightRx * Math.cos(Math.PI * moonProg), y: cy + nightRy * Math.sin(Math.PI * moonProg) }
    : null

  return (
    <div className="hm-sun-block-v2">
      <svg viewBox={`0 0 ${W} ${H + 50}`} width="100%" style={{ overflow: 'visible', maxWidth: 380 }}>
        {/* Night arc (below baseline) */}
        <path
          d={`M ${cx - nightRx} ${cy} A ${nightRx} ${nightRy} 0 0 0 ${cx + nightRx} ${cy}`}
          fill="none"
          stroke="rgba(148,163,184,0.25)"
          strokeWidth="1.5"
          strokeDasharray="3 4"
        />
        {/* Day arc (above baseline) */}
        <path
          d={`M ${cx - dayRx} ${cy} A ${dayRx} ${dayRy} 0 0 1 ${cx + dayRx} ${cy}`}
          fill="none"
          stroke="rgba(251,191,36,0.3)"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        {/* Horizon line */}
        <line x1={cx - dayRx - 10} y1={cy} x2={cx + dayRx + 10} y2={cy} stroke="var(--border)" strokeWidth="1" />

        {/* Sunrise / sunset tick marks */}
        <line x1={cx - dayRx} y1={cy - 6} x2={cx - dayRx} y2={cy + 6} stroke="rgba(251,191,36,0.5)" strokeWidth="1.5" />
        <line x1={cx + dayRx} y1={cy - 6} x2={cx + dayRx} y2={cy + 6} stroke="rgba(251,191,36,0.5)" strokeWidth="1.5" />

        {/* Sunrise label */}
        <text x={cx - dayRx} y={cy + 22} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="var(--text-muted)" letterSpacing="0.04em" texttransform="uppercase">RISE</text>
        <text x={cx - dayRx} y={cy + 34} textAnchor="middle" fontSize="11" fontFamily="var(--font-mono)" fill="var(--text-sec)" fontWeight="600">{formatTime(rise)}</text>

        {/* Sunset label */}
        <text x={cx + dayRx} y={cy + 22} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="var(--text-muted)" letterSpacing="0.04em">SET</text>
        <text x={cx + dayRx} y={cy + 34} textAnchor="middle" fontSize="11" fontFamily="var(--font-mono)" fill="var(--text-sec)" fontWeight="600">{formatTime(set)}</text>

        {/* Sun marker */}
        {sunPos && (
          <>
            <circle cx={sunPos.x} cy={sunPos.y} r={11} fill="#fbbf24" opacity="0.2" />
            <circle cx={sunPos.x} cy={sunPos.y} r={7} fill="#fbbf24" />
            <circle cx={sunPos.x} cy={sunPos.y} r={4} fill="#fde68a" />
          </>
        )}
        {/* Sun at horizon (not currently moving) */}
        {!sunPos && (
          <>
            <circle cx={cx - dayRx} cy={cy} r={5} fill="#fbbf24" opacity={0.4} />
            <circle cx={cx + dayRx} cy={cy} r={5} fill="#fbbf24" opacity={0.4} />
          </>
        )}

        {/* Moon marker */}
        {moonPos && (
          <>
            <circle cx={moonPos.x} cy={moonPos.y} r={9} fill="rgba(148,163,184,0.15)" />
            <circle cx={moonPos.x} cy={moonPos.y} r={6} fill="#94a3b8" />
            <circle cx={moonPos.x + 2} cy={moonPos.y - 1} r={4} fill="#1e3050" />
          </>
        )}

        {/* Day length centered */}
        {dayLen != null && (
          <>
            <text x={cx} y={cy - 10} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--text-muted)">
              {Math.floor(dayLen/60)}h {dayLen%60}m daylight
            </text>
          </>
        )}
      </svg>

      <div className="hm-sun-meta">
        <div className="hm-sun-meta-item">
          <span className="hm-sun-meta-icon"><WeatherIcon name="sunrise" size={20} /></span>
          <div>
            <div className="hm-sun-meta-label">Sunrise</div>
            <div className="hm-sun-meta-val">{formatTime(rise)}</div>
          </div>
        </div>
        <div className="hm-sun-meta-item">
          <span className="hm-sun-meta-icon"><WeatherIcon name="sunset" size={20} /></span>
          <div>
            <div className="hm-sun-meta-label">Sunset</div>
            <div className="hm-sun-meta-val">{formatTime(set)}</div>
          </div>
        </div>
        {dayLen != null && (
          <div className="hm-sun-meta-item">
            <span className="hm-sun-meta-icon"><WeatherIcon name="time-afternoon" size={20} /></span>
            <div>
              <div className="hm-sun-meta-label">Daylight</div>
              <div className="hm-sun-meta-val">{Math.floor(dayLen/60)}h {dayLen%60}m</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Precip Bar ─────────────────────────────────────────────────────────────

function PrecipBar({ value, max, color = '#38bdf8', label }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="hm-precip-bar-row">
      <div className="hm-precip-bar-label">{label}</div>
      <div className="hm-precip-bar-track">
        <div className="hm-precip-bar-fill" style={{ width: `${pct}%`, background: color }}/>
      </div>
      <div className="hm-precip-bar-value">{Math.round(value)}%</div>
    </div>
  )
}

// ── Wind Compass Section ───────────────────────────────────────────────────

function WindSection({ c, daily, windUnit }) {
  return (
    <div className="hm-wind-card">
      <div className="hm-wind-compass">
        <div className="hm-compass-ring">
          {['N','NE','E','SE','S','SW','W','NW'].map((dir, i) => (
            <span key={dir} className="hm-compass-label" style={{ transform: `rotate(${i*45}deg) translateY(-38px) rotate(-${i*45}deg)` }}>
              {dir}
            </span>
          ))}
          <div className="hm-compass-arrow" style={{ transform: `rotate(${c.wind_direction_10m ?? 0}deg)` }}>
            <div className="hm-arrow-head"/>
            <div className="hm-arrow-tail"/>
          </div>
          <div className="hm-compass-center"/>
        </div>
      </div>
      <div className="hm-wind-details">
        <div className="hm-wind-stat">
          <div className="hm-wind-stat-label">Speed</div>
          <div className="hm-wind-stat-val">{Math.round(c.wind_speed_10m)} {windUnit}</div>
        </div>
        <div className="hm-wind-stat">
          <div className="hm-wind-stat-label">Direction</div>
          <div className="hm-wind-stat-val">{windDir(c.wind_direction_10m)} ({Math.round(c.wind_direction_10m ?? 0)}°)</div>
        </div>
        {daily?.wind_speed_10m_max?.[0] != null && (
          <div className="hm-wind-stat">
            <div className="hm-wind-stat-label">Today Max</div>
            <div className="hm-wind-stat-val">{Math.round(daily.wind_speed_10m_max[0])} {windUnit}</div>
          </div>
        )}
        {daily?.wind_speed_10m_min?.[0] != null && (
          <div className="hm-wind-stat">
            <div className="hm-wind-stat-label">Today Min</div>
            <div className="hm-wind-stat-val">{Math.round(daily.wind_speed_10m_min[0])} {windUnit}</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── UV Section ─────────────────────────────────────────────────────────────

function UvSection({ uv }) {
  if (uv == null) return null
  const pct = Math.min(100, (uv / 11) * 100)
  return (
    <div className="hm-uv-card">
      <div className="hm-uv-bar-track">
        <div className="hm-uv-dot" style={{ left: `${pct}%`, background: uvColor(uv) }}/>
      </div>
      <div className="hm-uv-labels">
        <span>Low</span><span>Mod</span><span>High</span><span>V.High</span><span>Ext</span>
      </div>
      <div className="hm-uv-reading" style={{ color: uvColor(uv) }}>
        <span className="hm-uv-num">{uv}</span>
        <span className="hm-uv-text">{uvLabel(uv)}</span>
      </div>
      {uv <= 1 && <div className="hm-uv-tip"><SI name="uv-index" size={14}/>Enjoy the moonlight</div>}
      {uv > 1 && uv <= 2 && <div className="hm-uv-tip"><SI name="uv-index" size={14}/> Low risk, enjoy the sun</div>}
      {uv > 2 && uv <= 5 && <div className="hm-uv-tip"><SI name="uv-index" size={14}/> Wear sunscreen and sunglasses</div>}
      {uv > 5 && uv <= 7 && <div className="hm-uv-tip"><SI name="uv-index" size={14}/> Wear sunscreen and sunglasses, seek shade when necessary</div>}
      {uv > 7 && uv <= 10 && <div className="hm-uv-tip"><SI name="uv-index-alert" size={14}/> Seek shade during midday hours</div>}
      {uv > 10 && <div className="hm-uv-tip"><SI name="uv-index-alert" size={14}/> Extreme UV, take all precautions</div>}
    </div>
  )
}

// ── Pollen Section ─────────────────────────────────────────────────────────

function pollenCategoryColor(category) {
  switch (category) {
    case 'None':      return '#6b8db5'
    case 'Very Low':  return '#22c55e'
    case 'Low':       return '#84cc16'
    case 'Moderate':  return '#eab308'
    case 'High':      return '#f97316'
    case 'Very High': return '#ef4444'
    default:          return '#6b8db5'
  }
}

function PollenSection({ pollenData }) {
  if (!pollenData?.current) {
    return <div className="hm-pollen-na">Loading pollen data…</div>
  }
  const { current, forecast } = pollenData
  return (
    <div className="hm-pollen-card">
      <div className="hm-pollen-types">
        {[
          { label: 'Tree',  d: current.tree },
          { label: 'Grass', d: current.grass },
        ].map(({ label, d }) => {
          const category = d?.indexInfo?.category ?? 'N/A'
          const value    = d?.indexInfo?.value
          const color    = pollenCategoryColor(category)
          return (
            <div key={label} className="hm-pollen-type">
              <div className="hm-pollen-type-name">{label}</div>
              <div className="hm-pollen-level-badge" style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}>{category}</div>
              {value != null && <div className="hm-pollen-val">{value}<span>/5</span></div>}
            </div>
          )
        })}
      </div>
      {forecast?.length > 0 && (
        <div className="hm-pollen-forecast">
          {forecast.map(({ date, tree, grass }) => {
            const vals   = [tree, grass].map(d => d?.indexInfo?.value ?? 0)
            const maxIdx = vals.indexOf(Math.max(...vals))
            const maxCat = [tree, grass][maxIdx]?.indexInfo?.category ?? 'None'
            const color  = pollenCategoryColor(maxCat)
            return (
              <div key={date} className="hm-pollen-day">
                <div className="hm-pollen-day-name">{formatDayShort(date + 'T12:00')}</div>
                <div className="hm-pollen-day-dot" style={{ background: color }} />
                <div className="hm-pollen-day-level" style={{ color }}>{maxCat}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const PollenIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7 }}>
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/>
    <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
  </svg>
)

function AirQualitySection({ aqData }) {
  if (!aqData) return <div className="hm-pollen-na">Loading air quality…</div>
  const { aqi, label, color, pm25, pm10, no2, o3 } = aqData
  const stats = [
    { key: 'PM2.5', val: pm25 != null ? `${Math.round(pm25)} µg/m³` : '—' },
    { key: 'PM10',  val: pm10 != null ? `${Math.round(pm10)} µg/m³` : '—' },
    { key: 'NO₂',  val: no2  != null ? `${Math.round(no2)} µg/m³`  : '—' },
    { key: 'O₃',   val: o3   != null ? `${Math.round(o3)} µg/m³`   : '—' },
  ]
  return (
    <div className="hm-aqi-card">
      <div className="hm-aqi-main">
        <div className="hm-aqi-number" style={{ color }}>{aqi ?? '—'}</div>
        <div className="hm-aqi-info">
          <div className="hm-aqi-label" style={{ color }}>{label}</div>
          <div className="hm-aqi-sublabel">US AQI</div>
        </div>
        <div className="hm-aqi-bar-wrap">
          <div className="hm-aqi-bar">
            <div className="hm-aqi-bar-fill" style={{ width: `${Math.min(100, ((aqi ?? 0) / 300) * 100)}%`, background: color }} />
          </div>
          <div className="hm-aqi-scale"><span>Good</span><span>Moderate</span><span>Unhealthy</span><span>Hazardous</span></div>
        </div>
      </div>
      <div className="hm-aqi-stats">
        {stats.map(({ key, val }) => (
          <div key={key} className="hm-aqi-stat">
            <div className="hm-aqi-stat-key">{key}</div>
            <div className="hm-aqi-stat-val">{val}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

const AqiIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7 }}>
    <path d="M8 16H3a1 1 0 0 1 0-2h5a2 2 0 0 0 0-4H3"/>
    <path d="M12 8H9a1 1 0 0 0 0 2h3a2 2 0 0 1 0 4H3"/>
    <path d="M17 12h-1a2 2 0 0 0 0 4h1a2 2 0 0 0 0-4z"/>
  </svg>
)

// ── NWS-Specific Stats ─────────────────────────────────────────────────────

function NwsExtras({ weatherData, units }) {
  if (!weatherData?.hourly?.weather_code) return null
  const tempUnit = units === 'imperial' ? '°F' : '°C'
  const hourly = weatherData.hourly
  const now = new Date()
  const startIdx = Math.max(0, hourly.time.findIndex(t => new Date(t) >= now))
  const next24Temps = hourly.temperature_2m.slice(startIdx, startIdx + 24)
  const next24Wind  = hourly.wind_speed_10m.slice(startIdx, startIdx + 24)
  const maxT = Math.max(...next24Temps.filter(Boolean))
  const minT = Math.min(...next24Temps.filter(Boolean))
  const maxW = Math.max(...next24Wind.filter(Boolean))
  const windUnit = units === 'imperial' ? 'mph' : 'km/h'

  return (
    <div className="hm-section">
      <div className="hm-section-title"><SI name="thermometer" />Next 24h Range</div>
      <div className="hm-stat-grid">
        <StatCard icon={<SI name="thermometer-sun" size={22}/>} label="24h High" value={`${Math.round(maxT)}${tempUnit}`} sub="Daytime peak" />
        <StatCard icon={<SI name="thermometer-raindrop" size={22}/>} label="24h Low"  value={`${Math.round(minT)}${tempUnit}`} sub="Overnight low" />
        <StatCard icon={<SI name="wind-alert" size={22}/>} label="Peak Wind" value={`${Math.round(maxW)} ${windUnit}`} sub="Max gusts expected" />
      </div>
    </div>
  )
}

// ── Feels Like Section ─────────────────────────────────────────────────────

function FeelsLikeSection({ c, tempUnit }) {
  if (!c) return null
  const diff = Math.round(c.apparent_temperature) - Math.round(c.temperature_2m)
  const reason = c.wind_speed_10m > 20
    ? 'Wind chill lowering perceived temp'
    : c.relative_humidity_2m > 70
    ? 'Humidity making it feel warmer'
    : Math.abs(diff) <= 2
    ? 'Conditions feel close to actual temp'
    : diff > 0 ? 'Feels warmer than actual' : 'Feels cooler than actual'

  const pct = Math.min(100, Math.max(0, ((c.apparent_temperature + 40) / 160) * 100))
  const color = c.apparent_temperature > 80 ? '#ef4444'
    : c.apparent_temperature > 65 ? '#f97316'
    : c.apparent_temperature > 45 ? '#22c55e'
    : '#38bdf8'

  return (
    <div className="hm-feels-card">
      <div className="hm-feels-temps">
        <div className="hm-feels-actual">
          <div className="hm-feels-label">Actual</div>
          <div className="hm-feels-num">{Math.round(c.temperature_2m)}{tempUnit}</div>
        </div>
        <div className="hm-feels-arrow">
          {diff > 0 ? '↑' : diff < 0 ? '↓' : '→'}
        </div>
        <div className="hm-feels-apparent">
          <div className="hm-feels-label">Feels Like</div>
          <div className="hm-feels-num" style={{ color }}>{Math.round(c.apparent_temperature)}{tempUnit}</div>
        </div>
      </div>
      <div className="hm-feels-bar-track">
        <div className="hm-feels-bar-fill" style={{ width: `${pct}%`, background: color }} />
        <div className="hm-feels-bar-dot" style={{ left: `${pct}%`, background: color }} />
      </div>
      <div className="hm-feels-reason">{reason}</div>
    </div>
  )
}

// ── Dew Point Section ──────────────────────────────────────────────────────

function DewPointSection({ c, tempUnit }) {
  if (!c) return null
  // Approximate dew point from temp + humidity
  const T = tempUnit === '°F'
    ? (c.temperature_2m - 32) * 5/9
    : c.temperature_2m
  const rh = c.relative_humidity_2m
  const dewC = T - ((100 - rh) / 5)
  const dew = tempUnit === '°F' ? Math.round(dewC * 9/5 + 32) : Math.round(dewC)
  const spread = Math.round(c.temperature_2m) - dew

  const comfortLabel = rh < 30 ? 'Very Dry' : rh < 45 ? 'Dry & Comfortable' : rh < 60 ? 'Comfortable' : rh < 70 ? 'Slightly Humid' : rh < 80 ? 'Humid & Muggy' : 'Very Oppressive'
  const comfortColor = rh < 30 ? '#38bdf8' : rh < 60 ? '#22c55e' : rh < 75 ? '#eab308' : '#ef4444'

  return (
    <div className="hm-dew-card">
      <div className="hm-dew-main">
        <div>
          <div className="hm-dew-label">Dew Point</div>
          <div className="hm-dew-val">{dew}{tempUnit}</div>
        </div>
        <div>
          <div className="hm-dew-label">Spread</div>
          <div className="hm-dew-val">{spread}°</div>
        </div>
        <div>
          <div className="hm-dew-label">Humidity</div>
          <div className="hm-dew-val">{rh}%</div>
        </div>
      </div>
      <div className="hm-dew-comfort" style={{ color: comfortColor, borderColor: `${comfortColor}40` }}>
        {comfortLabel}
      </div>
      <div className="hm-dew-tip" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
        {rh < 40 ? 'Low dew point — dry air, consider a humidifier.' : rh > 70 ? 'High dew point — air feels heavy and muggy.' : 'Comfortable moisture level for most people.'}
      </div>
    </div>
  )
}

// ── Pressure Section ───────────────────────────────────────────────────────

function PressureSection({ c, hourly }) {
  if (!c?.surface_pressure) return null
  const hpa = Math.round(c.surface_pressure)
  const inHg = (hpa * 0.02953).toFixed(2)

  // Build last 6h mini sparkline from hourly data
  const now = new Date()
  const idx = hourly ? Math.max(0, hourly.time.findIndex(t => new Date(t) >= now) - 1) : -1
  const pressures = idx >= 5 && hourly?.surface_pressure
    ? hourly.surface_pressure.slice(idx - 5, idx + 1)
    : null

  const trend = pressures
    ? pressures[pressures.length - 1] - pressures[0] > 1.5 ? 'Rising' : pressures[0] - pressures[pressures.length - 1] > 1.5 ? 'Falling' : 'Steady'
    : pressureTrend(hpa).replace(/[↑↓→] /, '')

  const trendColor = trend === 'Rising' ? '#22c55e' : trend === 'Falling' ? '#ef4444' : '#6b8db5'
  const trendIcon = trend === 'Rising' ? '↑' : trend === 'Falling' ? '↓' : '→'

  // Sparkline
  let sparkPath = null
  if (pressures && pressures.length > 1) {
    const min = Math.min(...pressures) - 1
    const max = Math.max(...pressures) + 1
    const W = 120, H = 32
    const pts = pressures.map((p, i) => {
      const x = (i / (pressures.length - 1)) * W
      const y = H - ((p - min) / (max - min)) * H
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    sparkPath = pts.join(' ')
  }

  return (
    <div className="hm-pressure-card">
      <div className="hm-pressure-main">
        <div>
          <div className="hm-pressure-label">hPa</div>
          <div className="hm-pressure-val">{hpa}</div>
        </div>
        <div>
          <div className="hm-pressure-label">inHg</div>
          <div className="hm-pressure-val">{inHg}</div>
        </div>
        <div>
          <div className="hm-pressure-label">Trend</div>
          <div className="hm-pressure-val" style={{ color: trendColor }}>{trendIcon} {trend}</div>
        </div>
      </div>
      {sparkPath && (
        <div className="hm-pressure-spark">
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Last 6 hours</div>
          <svg viewBox="0 0 120 32" width="120" height="32">
            <path d={sparkPath} fill="none" stroke={trendColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
          </svg>
        </div>
      )}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
        {hpa < 1000 ? 'Low pressure — stormy or unsettled weather likely.' : hpa > 1020 ? 'High pressure — clear and stable conditions.' : 'Normal atmospheric pressure.'}
      </div>
    </div>
  )
}

// ── Cloud Cover Section ────────────────────────────────────────────────────

function cloudSkyLabel(pct) {
  if (pct == null) return '—'
  if (pct <= 10)  return 'Clear Sky'
  if (pct <= 30)  return 'Mostly Clear'
  if (pct <= 60)  return 'Partly Cloudy'
  if (pct <= 85)  return 'Mostly Cloudy'
  return 'Overcast'
}

function cloudSkyColor(pct) {
  if (pct == null) return '#6b8db5'
  if (pct <= 10)  return '#fbbf24'
  if (pct <= 30)  return '#60a5fa'
  if (pct <= 60)  return '#94a3b8'
  return '#6b7280'
}

const CloudCoverIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7 }}>
    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/>
  </svg>
)

function formatHourInZone(isoString, timezone) {
  if (!isoString) return ''
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: true,
      timeZone: timezone,
    }).format(new Date(isoString)).replace(' ', '').toLowerCase()
  } catch {
    return formatHourShort(isoString)
  }
}

function CloudCoverSection({ ccData }) {
  const currentPct = ccData?.currentCloudCover ?? null
  const chartVals  = ccData?.chartValues  ?? []
  const chartTimes = ccData?.chartTimes   ?? []
  const timezone   = ccData?.timezone     ?? 'UTC'

  const color = cloudSkyColor(currentPct)

  if (!ccData) return <div className="hm-cloud-na">Loading cloud cover…</div>

  // SVG area chart
  let linePath = '', areaPath = ''
  if (chartVals.length > 1) {
    const W = 200, H = 44
    const pts = chartVals.map((v, i) => [
      (i / (chartVals.length - 1)) * W,
      H - ((v ?? 0) / 100) * H,
    ])
    linePath = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
    areaPath = `${linePath} L${pts[pts.length - 1][0].toFixed(1)} ${H} L0 ${H} Z`
  }

  const labelIdxs = [0, 6, 12, 18, chartVals.length - 1].filter((i, pos, arr) =>
    i < chartVals.length && arr.indexOf(i) === pos
  )

  return (
    <div className="hm-cloud-card">
      <div className="hm-cloud-main">
        <div className="hm-cloud-pct" style={{ color }}>
          {currentPct != null ? `${Math.round(currentPct)}%` : '—'}
        </div>
        <div className="hm-cloud-label">{cloudSkyLabel(currentPct)}</div>
      </div>
      {chartVals.length > 1 && (
        <div className="hm-cloud-chart-wrap">
          <svg viewBox="0 0 200 44" preserveAspectRatio="none" className="hm-cloud-svg">
            <defs>
              <linearGradient id="cc-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.4"/>
                <stop offset="100%" stopColor="#94a3b8" stopOpacity="0.04"/>
              </linearGradient>
            </defs>
            <line x1="0" y1="22" x2="200" y2="22" stroke="rgba(255,255,255,0.07)" strokeWidth="1"/>
            <path d={areaPath} fill="url(#cc-fill)"/>
            <path d={linePath} fill="none" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div className="hm-cloud-time-row">
            {labelIdxs.map(i => (
              <span
                key={i}
                className="hm-cloud-time-label"
                style={{ left: `${(i / (chartVals.length - 1)) * 100}%` }}
              >
                {formatHourInZone(chartTimes[i], timezone)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Home Component ────────────────────────────────────────────────────

export default function Home({ onOpenRadar }) {
  const [settings, updateSettings] = useSettings()
  const { data: weatherData, loading, error, refresh } = useWeather(
    settings.lat, settings.lon, settings.units, settings.weatherProvider, settings.owmApiKey
  )
  const { alerts } = useAlerts(settings.lat, settings.lon)
  const isDesktop = useIsDesktop()

  const [searchInput, setSearchInput] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedAlert, setSelectedAlert] = useState(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [selectedDayIdx, setSelectedDayIdx] = useState(null)

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!searchInput.trim()) return
    setSearching(true); setSearchError(null)
    try {
      const isZip = /^\d{5}(-\d{4})?$/.test(searchInput.trim())
      const query = isZip ? `${searchInput.trim()} postal code USA` : searchInput.trim()
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`,
        { headers: { 'Accept-Language': 'en', 'User-Agent': 'WeatherApp/1.0' } }
      )
      const results = await resp.json()
      if (!results.length) { setSearchError('Location not found.'); return }
      const r = results[0]
      const addr = r.address
      const parts = [addr.city||addr.town||addr.village||addr.county, addr.state, addr.country_code?.toUpperCase()].filter(Boolean)
      const locationName = isZip ? `${searchInput.trim()}, ${parts.slice(0,2).join(', ')}` : parts.slice(0,2).join(', ')
      updateSettings({ lat: parseFloat(r.lat), lon: parseFloat(r.lon), locationName })
      setSearchInput(''); setSearchOpen(false)
    } catch (err) { setSearchError('Search failed.') }
    finally { setSearching(false) }
  }

  const handleGps = () => {
    if (!navigator.geolocation) { setSearchError('Geolocation not supported.'); return }
    setGpsLoading(true); setSearchError(null)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords
        try {
          const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`, { headers: { 'Accept-Language': 'en', 'User-Agent': 'WeatherApp/1.0' } })
          const r = await resp.json()
          const addr = r.address ?? {}
          const parts = [addr.city||addr.town||addr.village||addr.county, addr.state].filter(Boolean)
          updateSettings({ lat: latitude, lon: longitude, locationName: parts.join(', ') || `${latitude.toFixed(3)}, ${longitude.toFixed(3)}` })
        } catch {
          updateSettings({ lat: latitude, lon: longitude, locationName: `${latitude.toFixed(3)}, ${longitude.toFixed(3)}` })
        }
        setGpsLoading(false); setSearchOpen(false)
      },
      () => { setGpsLoading(false); setSearchError('Location access denied.') },
      { timeout: 10000, maximumAge: 60000 }
    )
  }

  const tempUnit = settings.units === 'imperial' ? '°F' : '°C'
  const windUnit = settings.units === 'imperial' ? 'mph' : 'km/h'
  const c        = weatherData?.current
  const daily    = weatherData?.daily
  const hourly   = weatherData?.hourly
  const { icon: rawIcon, label } = c ? getWeatherInfo(c.weather_code) : { icon: 'thermometer', label: '' }
  const icon = c && daily ? (isDaytime(new Date().toISOString(), daily) ? rawIcon : toNightIcon(rawIcon)) : rawIcon
  const isNws    = settings.weatherProvider === 'nws'
  const uv        = daily?.uv_index_max?.[0] ?? null
  const pollenData   = usePollen(settings.lat, settings.lon)
  const aqData       = useAirQuality(settings.lat, settings.lon, settings.aqiProvider ?? 'google')
  const ccData       = useCloudCover(settings.lat, settings.lon)

  // ── Shared top bar & search (identical on both layouts) ──────────────────

  const topbar = (
    <div className="hm-topbar">
      <button className="hm-loc-btn" onClick={() => setSearchOpen(s => !s)}>
        <span className="hm-loc-pin">📍</span>
        <span className="hm-loc-name">{settings.locationName || 'Set location'}</span>
        <span className="hm-loc-caret">▾</span>
      </button>
      <div className="hm-topbar-right">
        {/* <button
          className={`hm-icon-btn hm-ai-btn${aiOpen ? ' wai-active' : ''}`}
          onClick={() => setAiOpen(o => !o)}
          title="AI weather summary"
          aria-label="Open AI weather assistant"
          aria-expanded={aiOpen}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M14.0416 16.2219L13.5749 17.8284C13.1036 19.4508 12.868 20.262 12.5051 20.4675C12.1917 20.6449 11.8083 20.6449 11.4949 20.4675C11.132 20.262 10.8964 19.4508 10.4251 17.8284L9.95843 16.2219L9.95843 16.2219C9.77921 15.6049 9.68961 15.2965 9.52195 15.043C9.37356 14.8186 9.18142 14.6264 8.95705 14.478C8.70355 14.3104 8.39507 14.2208 7.77812 14.0416L7.77811 14.0416L6.1716 13.5749C4.5492 13.1036 3.738 12.868 3.5325 12.5051C3.35507 12.1917 3.35507 11.8083 3.5325 11.4949C3.738 11.132 4.5492 10.8964 6.1716 10.4251L7.77811 9.95843L7.77812 9.95843C8.39507 9.77922 8.70355 9.68961 8.95705 9.52195C9.18142 9.37356 9.37356 9.18142 9.52195 8.95705C9.68961 8.70355 9.77921 8.39507 9.95843 7.77812L9.95843 7.77811L10.4251 6.1716C10.8964 4.5492 11.132 3.738 11.4949 3.5325C11.8083 3.35507 12.1917 3.35507 12.5051 3.5325C12.868 3.738 13.1036 4.5492 13.5749 6.1716L14.0416 7.77811L14.0416 7.77812C14.2208 8.39507 14.3104 8.70355 14.478 8.95705C14.6264 9.18142 14.8186 9.37356 15.043 9.52195C15.2965 9.68961 15.6049 9.77921 16.2219 9.95843L16.2219 9.95843L17.8284 10.4251C19.4508 10.8964 20.262 11.132 20.4675 11.4949C20.6449 11.8083 20.6449 12.1917 20.4675 12.5051C20.262 12.868 19.4508 13.1036 17.8284 13.5749L16.2219 14.0416L16.2219 14.0416C15.6049 14.2208 15.2965 14.3104 15.043 14.478C14.8186 14.6264 14.6264 14.8186 14.478 15.043C14.3104 15.2965 14.2208 15.6049 14.0416 16.2219L14.0416 16.2219Z" stroke="#F5F5F5" strokeWidth="1.5"/>
          <path d="M5.42282 5.94949L5.01129 7.20368C4.92849 7.45603 4.57151 7.45603 4.48871 7.20368L4.07718 5.94949C3.99537 5.70017 3.79983 5.50463 3.55051 5.42282L2.29632 5.01129C2.04397 4.92849 2.04397 4.57151 2.29632 4.48871L3.55051 4.07718C3.79983 3.99537 3.99537 3.79983 4.07718 3.55051L4.48871 2.29632C4.57151 2.04397 4.92849 2.04397 5.01129 2.29632L5.42282 3.55051C5.50463 3.79983 5.70017 3.99537 5.94949 4.07718L7.20368 4.48871C7.45603 4.57151 7.45603 4.92849 7.20368 5.01129L5.94949 5.42282C5.70017 5.50463 5.50463 5.70017 5.42282 5.94949Z" fill="#0F8BFF"/>
          <path d="M19.9228 20.4495L19.5113 21.7037C19.4285 21.956 19.0715 21.956 18.9887 21.7037L18.5772 20.4495C18.4954 20.2002 18.2998 20.0046 18.0505 19.9228L16.7963 19.5113C16.544 19.4285 16.544 19.0715 16.7963 18.9887L18.0505 18.5772C18.2998 18.4954 18.4954 18.2998 18.5772 18.0505L18.9887 16.7963C19.0715 16.544 19.4285 16.544 19.5113 16.7963L19.9228 18.0505C20.0046 18.2998 20.2002 18.4954 20.4495 18.5772L21.7037 18.9887C21.956 19.0715 21.956 19.4285 21.7037 19.5113L20.4495 19.9228C20.2002 20.0046 20.0046 20.2002 19.9228 20.4495Z" fill="#0F8BFF"/>
          </svg>
        </button>*/}
        <button className="hm-icon-btn" onClick={refresh} title="Refresh" aria-label="Refresh">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
        <button className="hm-icon-btn hm-radar-btn" onClick={onOpenRadar} title="Full radar" aria-label="Open radar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M20.07 3.93a10 10 0 0 1 0 16.14M3.93 20.07a10 10 0 0 1 0-16.14"/>
          </svg>
        </button>
      </div>
    </div>
  )

  const searchDrawer = searchOpen && (
    <div className="hm-search-drawer">
      <form onSubmit={handleSearch} className="hm-search-form">
        <input
          type="text"
          className="hm-search-input"
          placeholder="Search city, zip code…"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          autoFocus
        />
        <button type="submit" className="hm-search-go" disabled={searching}>
          {searching ? '…' : '🔍'}
        </button>
        <button type="button" className="hm-search-gps" onClick={handleGps} disabled={gpsLoading}>
          {gpsLoading ? <span className="hm-gps-spin"/> : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
            </svg>
          )}
        </button>
      </form>
      {searchError && <div className="hm-search-error">{searchError}</div>}
    </div>
  )

  // ── Loading / error states ───────────────────────────────────────────────

  if (loading || error || !c) {
    return (
      <div className="hm-root">
        {topbar}
        {searchDrawer}
        {alerts?.length > 0 && <AlertStrip alerts={alerts} onAlertClick={setSelectedAlert} />}
        {loading && (
          <div className="hm-loading">
            <div className="hm-spinner"/>
            <p>Loading weather…</p>
          </div>
        )}
        {!loading && error && (
          <div className="hm-error">
            <div style={{ fontSize: 32 }}>⚠️</div>
            <div>{error}</div>
            <button className="hm-retry-btn" onClick={refresh}>↺ Retry</button>
          </div>
        )}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DESKTOP LAYOUT
  // ══════════════════════════════════════════════════════════════════════════

  if (isDesktop) {
    return (
      <div className="hm-root">
        {topbar}
        {searchDrawer}
        {alerts?.length > 0 && <AlertStrip alerts={alerts} onAlertClick={setSelectedAlert} />}

        <div className="hm-desktop-body">

          {/* ── Left Sidebar ────────────────────────────────────────────── */}
          <div className="hm-sidebar">

            {/* Hero: big temp + conditions */}
            <div className="hm-hero">
              <div className="hm-hero-left">
                <div className="hm-big-icon"><WeatherIcon name={icon} size={88} /></div>
                <div className="hm-big-temp">{Math.round(c.temperature_2m)}{tempUnit}</div>
                <div className="hm-big-desc">{label}</div>
                <div className="hm-big-feels">Feels like {Math.round(c.apparent_temperature)}{tempUnit}</div>
                <div className="hm-hero-sub-stats">
                  <span><SI name="wind" size={14}/> {Math.round(c.wind_speed_10m)} {windUnit} {windDir(c.wind_direction_10m)}</span>
                  <span><SI name="humidity" size={14}/> {c.relative_humidity_2m}%</span>
                  {c.surface_pressure && <span><SI name="barometer" size={14}/> {Math.round(c.surface_pressure)} hPa</span>}
                </div>
              </div>

              {/* Radar thumbnail — full-width in sidebar */}
              <RadarMini lat={settings.lat} lon={settings.lon} onOpenRadar={onOpenRadar} style={{ width: '100%', height: 180 }} />
            </div>

            {/* Sun & Daylight */}
            {daily && (
              <div className="hm-section">
                <div className="hm-section-title"><SI name="sunrise" />Sun &amp; Daylight</div>
                <SunMoonBlock daily={daily} />
              </div>
            )}

            {/* Key stat cards */}
            <div className="hm-section">
              <div className="hm-section-title"><SI name="thermometer" />Current Conditions</div>
              <div className="hm-stat-grid">
                <StatCard icon={<SI name="wind" size={22}/>} label="Wind"value={`${Math.round(c.wind_speed_10m)} ${windUnit}`} sub={windDir(c.wind_direction_10m)} accent="#38bdf8" />
                <StatCard icon={<SI name="humidity" size={22}/>} label="Humidity" value={`${c.relative_humidity_2m}%`} sub={humidityLabel(c.relative_humidity_2m)} accent="#7dd3fc" />
                {c.surface_pressure != null && (
                  <StatCard icon={<SI name="barometer" size={22}/>} label="Pressure" value={`${Math.round(c.surface_pressure)} hPa`} sub={pressureTrend(c.surface_pressure)} accent="#a78bfa" />
                )}
                {uv != null && (
                  <StatCard icon={<SI name="uv-index" size={22}/>} label="UV Index" value={String(uv)} sub={uvLabel(uv)} subColor={uvColor(uv)} accent={uvColor(uv)} />
                )}
                {daily?.precipitation_sum?.[0] != null && (
                  <StatCard icon={<SI name="raindrop-measure" size={22}/>} label="Precip Today" value={`${daily.precipitation_sum[0] ?? 0} ${settings.units === 'imperial' ? 'in' : 'mm'}`} sub="Accumulated" accent="#38bdf8" />
                )}
                {daily?.wind_speed_10m_max?.[0] != null && (
                  <StatCard icon={<SI name="wind-alert" size={22}/>} label="Wind Max" value={`${Math.round(daily.wind_speed_10m_max[0])} ${windUnit}`} sub="Today's peak" accent="#f97316" />
                )}
              </div>
            </div>

            {/* NWS extras */}
            {isNws && hourly && <NwsExtras weatherData={weatherData} units={settings.units} />}

          </div>

          {/* ── Right Main Panel ────────────────────────────────────────── */}
          <div className="hm-main-panel">

            {/* Hourly — standalone full-width strip */}
            {hourly && (
              <div className="hm-section">
                <div className="hm-section-title"><SI name="time-afternoon" />Hourly Forecast</div>
                <HourlyRow hourly={hourly} units={settings.units} daily={daily} />
              </div>
            )}

            {/* Top grid: 7-day (left) + Wind & UV stacked (right) */}
            <div className="hm-desktop-top-grid">
              {daily && <DailyForecast daily={daily} units={settings.units} isDesktop={true} onDayClick={setSelectedDayIdx} />}
              <div className="hm-desktop-top-right">
                <div className="hm-section">
                  <div className="hm-section-title"><SI name="compass" />Wind Details</div>
                  <WindSection c={c} daily={daily} windUnit={windUnit} />
                </div>
                <div className="hm-section">
                  <div className="hm-section-title"><SI name="uv-index" />UV Index</div>
                  <UvSection uv={uv} />
                </div>
              </div>
            </div>

            {/* Mid grid: rain chance + pollen + air quality */}
            <div className="hm-desktop-mid-grid">
              {daily?.precipitation_probability_max && (
                <div className="hm-section">
                  <div className="hm-section-title"><SI name="raindrop" />Rain Chance — 7 Days</div>
                  <div className="hm-precip-bars">
                    {daily.time.slice(0, 7).map((t, i) => (
                      <PrecipBar
                        key={t}
                        label={formatDayShort(t)}
                        value={daily.precipitation_probability_max[i] ?? 0}
                        max={100}
                        color={`rgba(56,189,248,${0.4 + (daily.precipitation_probability_max[i] ?? 0) / 200})`}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div className="hm-section">
                <div className="hm-section-title"><PollenIcon />Pollen</div>
                <PollenSection pollenData={pollenData} />
              </div>
              <div className="hm-section">
                <div className="hm-section-title"><AqiIcon />Air Quality</div>
                <AirQualitySection aqData={aqData} />
              </div>
            </div>

            {/* Bottom detail grid */}
            <div className="hm-desktop-bottom-grid">
              <div className="hm-section">
                <div className="hm-section-title"><SI name="thermometer-sun" />Feels Like</div>
                <FeelsLikeSection c={c} tempUnit={tempUnit} />
              </div>
              <div className="hm-section">
                <div className="hm-section-title"><SI name="humidity" />Dew Point</div>
                <DewPointSection c={c} tempUnit={tempUnit} />
              </div>
              <div className="hm-section">
                <div className="hm-section-title"><SI name="barometer" />Pressure Detail</div>
                <PressureSection c={c} hourly={hourly} />
              </div>
              <div className="hm-section">
                <div className="hm-section-title"><CloudCoverIcon />Cloud Cover (POTENTIALY INACURATE)</div>
                <CloudCoverSection ccData={ccData} />
              </div>
            </div>
          </div>
        </div>

      <WeatherAIPopup
        weatherData={weatherData}
        pollenData={pollenData}
        aqData={aqData}
        locationName={settings.locationName}
        units={settings.units}
        isOpen={aiOpen}
        onClose={() => setAiOpen(false)}
      />
      <AlertModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
      {selectedDayIdx != null && daily && (
        <DayDetailPopup
          daily={daily}
          hourly={hourly}
          dayIdx={selectedDayIdx}
          units={settings.units}
          onClose={() => setSelectedDayIdx(null)}
        />
      )}
    </div>
  )
}

  // ══════════════════════════════════════════════════════════════════════════
  // MOBILE LAYOUT (original)
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div className="hm-root">
      {topbar}
      {searchDrawer}
      {alerts?.length > 0 && <AlertStrip alerts={alerts} onAlertClick={setSelectedAlert} />}

      <div className="hm-content">

        {/* Hero */}
        <div className="hm-hero">
          <div className="hm-hero-left">
            <div className="hm-big-icon"><WeatherIcon name={icon} size={72} /></div>
            <div className="hm-big-temp">{Math.round(c.temperature_2m)}{tempUnit}</div>
            <div className="hm-big-desc">{label}</div>
            <div className="hm-big-feels">Feels like {Math.round(c.apparent_temperature)}{tempUnit}</div>
            <div className="hm-hero-sub-stats">
              <span><SI name="wind" size={14}/> {Math.round(c.wind_speed_10m)} {windUnit} {windDir(c.wind_direction_10m)}</span>
              <span><SI name="humidity" size={14}/> {c.relative_humidity_2m}%</span>
              {c.surface_pressure && <span><SI name="barometer" size={14}/> {Math.round(c.surface_pressure)} hPa</span>}
            </div>
          </div>
          <RadarMini lat={settings.lat} lon={settings.lon} onOpenRadar={onOpenRadar} />
        </div>

        {hourly && (
          <div className="hm-section">
            <div className="hm-section-title"><SI name="time-afternoon" />Hourly Forecast</div>
            <HourlyRow hourly={hourly} units={settings.units} daily={daily} />
          </div>
        )}

        {daily && <DailyForecast daily={daily} units={settings.units} isDesktop={false} onDayClick={setSelectedDayIdx} />}

        {daily && (
          <div className="hm-section">
            <div className="hm-section-title"><SI name="sunrise" />Sun &amp; Daylight</div>
            <SunMoonBlock daily={daily} />
          </div>
        )}

        <div className="hm-section">
          <div className="hm-section-title"><SI name="thermometer" />Current Conditions</div>
          <div className="hm-stat-grid">
            <StatCard icon={<SI name="wind" size={22}/>} label="Wind"value={`${Math.round(c.wind_speed_10m)} ${windUnit}`} sub={`${windDir(c.wind_direction_10m)} · ${windDir(c.wind_direction_10m)}`} accent="#38bdf8" />
            <StatCard icon={<SI name="humidity" size={22}/>} label="Humidity" value={`${c.relative_humidity_2m}%`} sub={humidityLabel(c.relative_humidity_2m)} accent="#7dd3fc" />
            {c.surface_pressure != null && (
              <StatCard icon={<SI name="barometer" size={22}/>} label="Pressure" value={`${Math.round(c.surface_pressure)} hPa`} sub={pressureTrend(c.surface_pressure)} accent="#a78bfa" />
            )}
            {uv != null && (
              <StatCard icon={<SI name="uv-index" size={22}/>} label="UV Index" value={String(uv)} sub={uvLabel(uv)} subColor={uvColor(uv)} accent={uvColor(uv)} />
            )}
            {daily?.precipitation_sum?.[0] != null && (
              <StatCard icon={<SI name="raindrop-measure" size={22}/>} label="Precip Today" value={`${daily.precipitation_sum[0] ?? 0} ${settings.units === 'imperial' ? 'in' : 'mm'}`} sub="Accumulated" accent="#38bdf8" />
            )}
            {daily?.wind_speed_10m_max?.[0] != null && (
              <StatCard icon={<SI name="wind-alert" size={22}/>} label="Wind Max" value={`${Math.round(daily.wind_speed_10m_max[0])} ${windUnit}`} sub="Today's peak" accent="#f97316" />
            )}
          </div>
        </div>

        {daily?.precipitation_probability_max && (
          <div className="hm-section">
            <div className="hm-section-title"><SI name="raindrop" />Rain Chance — Next 7 Days</div>
            <div className="hm-precip-bars">
              {daily.time.slice(0, 7).map((t, i) => (
                <PrecipBar
                  key={t}
                  label={formatDayShort(t)}
                  value={daily.precipitation_probability_max[i] ?? 0}
                  max={100}
                  color={`rgba(56,189,248,${0.4 + (daily.precipitation_probability_max[i] ?? 0) / 200})`}
                />
              ))}
            </div>
          </div>
        )}

        <div className="hm-section">
          <div className="hm-section-title"><SI name="compass" />Wind Details</div>
          <WindSection c={c} daily={daily} windUnit={windUnit} />
        </div>

        {isNws && hourly && <NwsExtras weatherData={weatherData} units={settings.units} />}
                <div className="hm-section">
          <div className="hm-section-title"><SI name="thermometer-sun" />Feels Like</div>
          <FeelsLikeSection c={c} tempUnit={tempUnit} />
        </div>

        <div className="hm-section">
          <div className="hm-section-title"><SI name="humidity" />Dew Point</div>
          <DewPointSection c={c} tempUnit={tempUnit} />
        </div>

        <div className="hm-section">
          <div className="hm-section-title"><SI name="barometer" />Pressure Detail</div>
          <PressureSection c={c} hourly={hourly} />
        </div>

        <div className="hm-section">
          <div className="hm-section-title"><CloudCoverIcon />Cloud Cover (POTENTIALY INACURATE)</div>
          <CloudCoverSection ccData={ccData} />
        </div>

        {uv != null && (
          <div className="hm-section">
            <div className="hm-section-title"><SI name="uv-index" />UV Index</div>
            <UvSection uv={uv} />
          </div>
        )}

        <div className="hm-section">
          <div className="hm-section-title"><PollenIcon />Pollen</div>
          <PollenSection pollenData={pollenData} />
        </div>

        <div className="hm-section">
          <div className="hm-section-title"><AqiIcon />Air Quality</div>
          <AirQualitySection aqData={aqData} />
        </div>

        <div className="hm-bottom-bar">
          <span>{isNws ? '📡 National Weather Service' : '🌍 Open-Meteo'}</span>
          <span>{settings.units === 'imperial' ? '°F · mph · in' : '°C · km/h · mm'}</span>
        </div>

        <button className="hm-open-radar-cta" onClick={() => { window.history.pushState({}, '', '/download'); window.dispatchEvent(new PopStateEvent('popstate')) }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download Android App
        </button>

      </div>
      <WeatherAIPopup
        weatherData={weatherData}
        pollenData={pollenData}
        aqData={aqData}
        locationName={settings.locationName}
        units={settings.units}
        isOpen={aiOpen}
        onClose={() => setAiOpen(false)}
      />
      <AlertModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
      {selectedDayIdx != null && daily && (
        <DayDetailPopup
          daily={daily}
          hourly={hourly}
          dayIdx={selectedDayIdx}
          units={settings.units}
          onClose={() => setSelectedDayIdx(null)}
        />
      )}
    </div>
  )
}