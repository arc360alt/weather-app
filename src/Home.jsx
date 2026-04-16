import { useState, useEffect, useCallback, useRef } from 'react'
import { useSettings } from './hooks/useSettings'
import { useWeather } from './hooks/useWeather'
import { useAlerts } from './hooks/useAlerts'
import { WEATHER_CODES } from './config/defaults'
import AlertModal from './components/AlertModal' 

// ── Helpers ────────────────────────────────────────────────────────────────

function getWeatherInfo(code) {
  return WEATHER_CODES[code] ?? { label: 'Unknown', icon: '🌡️' }
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
    fetch('https://api.rainviewer.com/public/weather-maps.json')
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

function HourlyRow({ hourly, units }) {
  const { time, temperature_2m, precipitation_probability, weather_code } = hourly
  const tempUnit = units === 'imperial' ? '°F' : '°C'
  const now = new Date()
  const startIdx = Math.max(0, time.findIndex(t => new Date(t) >= now))
  const slice = time.slice(startIdx, startIdx + 24)
  const temps = temperature_2m.slice(startIdx, startIdx + 24)
  const probs = precipitation_probability.slice(startIdx, startIdx + 24)
  const codes = weather_code.slice(startIdx, startIdx + 24)

  const scrollRef = useRef(null)
  const isDragging = useRef(false)
  const startX = useRef(0)
  const scrollLeft = useRef(0)

  const onMouseDown = (e) => {
    isDragging.current = true
    startX.current = e.pageX - scrollRef.current.offsetLeft
    scrollLeft.current = scrollRef.current.scrollLeft
    scrollRef.current.style.cursor = 'grabbing'
    scrollRef.current.style.userSelect = 'none'
  }

  const onMouseMove = (e) => {
    if (!isDragging.current) return
    e.preventDefault()
    const x = e.pageX - scrollRef.current.offsetLeft
    const walk = (x - startX.current) * 1.2
    scrollRef.current.scrollLeft = scrollLeft.current - walk
  }

  const onMouseUp = () => {
    isDragging.current = false
    scrollRef.current.style.cursor = 'grab'
    scrollRef.current.style.userSelect = ''
  }

  return (
    <div
      ref={scrollRef}
      className="hm-hourly-scroll"
      style={{ cursor: 'grab' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {slice.map((t, i) => {
        const { icon } = getWeatherInfo(codes[i])
        return (
          <div key={t} className="hm-hourly-item">
            <div className="hm-hourly-time">{i === 0 ? 'Now' : formatHourShort(t)}</div>
            <div className="hm-hourly-icon">{icon}</div>
            <div className="hm-hourly-temp">{Math.round(temps[i])}{tempUnit}</div>
            {probs[i] > 10 && <div className="hm-hourly-precip">💧{probs[i]}%</div>}
          </div>
        )
      })}
    </div>
  )
}

// ── 7-Day Forecast ─────────────────────────────────────────────────────────

function DailyForecast({ daily, units, isDesktop }) {
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
          <div key={t} className="hm-daily-row">
            <div className="hm-daily-day">{formatDayShort(t)}</div>
            <div className="hm-daily-icon">{icon}</div>
            {prob > 10 ? <div className="hm-daily-precip">💧{prob}%</div> : <div className="hm-daily-precip" />}
            <div className="hm-daily-temps">
              <span className="hm-daily-lo">{lo}{tempUnit}</span>
              <div className="hm-daily-bar-track">
                <div className="hm-daily-bar-fill" style={{ left: `${barLeft}%`, width: `${Math.max(barWidth, 8)}%` }} />
              </div>
              <span className="hm-daily-hi">{hi}{tempUnit}</span>
            </div>
          </div>
        )
      })}
    </div>
  )

  if (isDesktop) {
    return (
      <div className="hm-section" style={{ borderBottom: 'none' }}>
        <div className="hm-section-title">📅 7-Day Forecast</div>
        {inner}
      </div>
    )
  }

  return (
    <div className="hm-section">
      <div className="hm-section-title">📅 7-Day Forecast</div>
      {inner}
    </div>
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
          <span className="hm-sun-meta-icon">🌅</span>
          <div>
            <div className="hm-sun-meta-label">Sunrise</div>
            <div className="hm-sun-meta-val">{formatTime(rise)}</div>
          </div>
        </div>
        <div className="hm-sun-meta-item">
          <span className="hm-sun-meta-icon">🌇</span>
          <div>
            <div className="hm-sun-meta-label">Sunset</div>
            <div className="hm-sun-meta-val">{formatTime(set)}</div>
          </div>
        </div>
        {dayLen != null && (
          <div className="hm-sun-meta-item">
            <span className="hm-sun-meta-icon">⏱</span>
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
      {uv <= 2 && <div className="hm-uv-tip">☀️ Low risk, enjoy the sun</div>}
      {uv > 2 && uv <= 5 && <div className="hm-uv-tip">☀️ Wear sunscreen and sunglasses</div>}
      {uv > 5 && uv <= 7 && <div className="hm-uv-tip">☀️ Wear sunscreen and sunglasses, seek shade when necessary</div>}
      {uv > 7 && uv <= 10 && <div className="hm-uv-tip">🕶 Seek shade during midday hours</div>}
      {uv > 10 && <div className="hm-uv-tip">☠️ Extreme UV, take all precautions</div>}
    </div>
  )
}

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
      <div className="hm-section-title">📊 Next 24h Range</div>
      <div className="hm-stat-grid">
        <StatCard icon="🌡️" label="24h High" value={`${Math.round(maxT)}${tempUnit}`} sub="Daytime peak" />
        <StatCard icon="🌡️" label="24h Low"  value={`${Math.round(minT)}${tempUnit}`} sub="Overnight low" />
        <StatCard icon="💨" label="Peak Wind" value={`${Math.round(maxW)} ${windUnit}`} sub="Max gusts expected" />
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
  const { icon, label } = c ? getWeatherInfo(c.weather_code) : { icon: '🌡️', label: '' }
  const isNws    = settings.weatherProvider === 'nws'
  const uv       = daily?.uv_index_max?.[0] ?? null

  // ── Shared top bar & search (identical on both layouts) ──────────────────

  const topbar = (
    <div className="hm-topbar">
      <button className="hm-loc-btn" onClick={() => setSearchOpen(s => !s)}>
        <span className="hm-loc-pin">📍</span>
        <span className="hm-loc-name">{settings.locationName || 'Set location'}</span>
        <span className="hm-loc-caret">▾</span>
      </button>
      <div className="hm-topbar-right">
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
                <div className="hm-big-icon">{icon}</div>
                <div className="hm-big-temp">{Math.round(c.temperature_2m)}{tempUnit}</div>
                <div className="hm-big-desc">{label}</div>
                <div className="hm-big-feels">Feels like {Math.round(c.apparent_temperature)}{tempUnit}</div>
                <div className="hm-hero-sub-stats">
                  <span>💨 {Math.round(c.wind_speed_10m)} {windUnit} {windDir(c.wind_direction_10m)}</span>
                  <span>💧 {c.relative_humidity_2m}%</span>
                  {c.surface_pressure && <span>🌡 {Math.round(c.surface_pressure)} hPa</span>}
                </div>
              </div>

              {/* Radar thumbnail — full-width in sidebar */}
              <RadarMini lat={settings.lat} lon={settings.lon} onOpenRadar={onOpenRadar} style={{ width: '100%', height: 180 }} />
            </div>

            {/* Sun & Daylight */}
            {daily && (
              <div className="hm-section">
                <div className="hm-section-title">☀️ Sun &amp; Daylight</div>
                <SunMoonBlock daily={daily} />
              </div>
            )}

            {/* Key stat cards */}
            <div className="hm-section">
              <div className="hm-section-title">📊 Current Conditions</div>
              <div className="hm-stat-grid">
                <StatCard icon="💨" label="Wind" value={`${Math.round(c.wind_speed_10m)} ${windUnit}`} sub={windDir(c.wind_direction_10m)} accent="#38bdf8" />
                <StatCard icon="💧" label="Humidity" value={`${c.relative_humidity_2m}%`} sub={humidityLabel(c.relative_humidity_2m)} accent="#7dd3fc" />
                {c.surface_pressure != null && (
                  <StatCard icon="🧭" label="Pressure" value={`${Math.round(c.surface_pressure)} hPa`} sub={pressureTrend(c.surface_pressure)} accent="#a78bfa" />
                )}
                {uv != null && (
                  <StatCard icon="🌤" label="UV Index" value={String(uv)} sub={uvLabel(uv)} subColor={uvColor(uv)} accent={uvColor(uv)} />
                )}
                {daily?.precipitation_sum?.[0] != null && (
                  <StatCard icon="🌧" label="Precip Today" value={`${daily.precipitation_sum[0] ?? 0} ${settings.units === 'imperial' ? 'in' : 'mm'}`} sub="Accumulated" accent="#38bdf8" />
                )}
                {daily?.wind_speed_10m_max?.[0] != null && (
                  <StatCard icon="💨" label="Wind Max" value={`${Math.round(daily.wind_speed_10m_max[0])} ${windUnit}`} sub="Today's peak" accent="#f97316" />
                )}
              </div>
            </div>

            {/* NWS extras */}
            {isNws && hourly && <NwsExtras weatherData={weatherData} units={settings.units} />}

            {/* Bottom provider strip */}
            <div className="hm-bottom-bar" style={{ marginTop: 'auto' }}>
              <span>{isNws ? '📡 National Weather Service' : '🌍 Open-Meteo'}</span>
              <span>{settings.units === 'imperial' ? '°F · mph · in' : '°C · km/h · mm'}</span>
            </div>
          </div>

          {/* ── Right Main Panel ────────────────────────────────────────── */}
          <div className="hm-main-panel">

            {/* Top grid: hourly + 7-day side by side */}
            <div className="hm-desktop-top-grid">
              {hourly && (
                <div className="hm-section">
                  <div className="hm-section-title">⏱ Hourly Forecast</div>
                  <HourlyRow hourly={hourly} units={settings.units} />
                </div>
              )}
              {daily && <DailyForecast daily={daily} units={settings.units} isDesktop={true} />}
            </div>

            {/* Mid grid: wind + UV + rain chance */}
            <div className="hm-desktop-mid-grid">
              <div className="hm-section">
                <div className="hm-section-title">🧭 Wind Details</div>
                <WindSection c={c} daily={daily} windUnit={windUnit} />
              </div>

              <div className="hm-section">
                <div className="hm-section-title">🌤 UV Index</div>
                <UvSection uv={uv} />
              </div>

              {daily?.precipitation_probability_max && (
                <div className="hm-section">
                  <div className="hm-section-title">🌧 Rain Chance — 7 Days</div>
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
            </div>
            {/* Bottom detail grid: Feels Like + Visibility + Dew Point + more */}
            <div className="hm-desktop-bottom-grid">
              {/* Feels Like Detail */}
              <div className="hm-section">
                <div className="hm-section-title">🌡 Feels Like</div>
                <FeelsLikeSection c={c} tempUnit={tempUnit} />
              </div>

              {/* Dew Point & Comfort */}
              <div className="hm-section">
                <div className="hm-section-title">💧 Dew Point</div>
                <DewPointSection c={c} tempUnit={tempUnit} />
              </div>

              {/* Pressure Trend */}
              <div className="hm-section">
                <div className="hm-section-title">🧭 Pressure Detail</div>
                <PressureSection c={c} hourly={hourly} />
              </div>
            </div>
          </div>
        </div>
        
      <AlertModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
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
            <div className="hm-big-icon">{icon}</div>
            <div className="hm-big-temp">{Math.round(c.temperature_2m)}{tempUnit}</div>
            <div className="hm-big-desc">{label}</div>
            <div className="hm-big-feels">Feels like {Math.round(c.apparent_temperature)}{tempUnit}</div>
            <div className="hm-hero-sub-stats">
              <span>💨 {Math.round(c.wind_speed_10m)} {windUnit} {windDir(c.wind_direction_10m)}</span>
              <span>💧 {c.relative_humidity_2m}%</span>
              {c.surface_pressure && <span>🌡 {Math.round(c.surface_pressure)} hPa</span>}
            </div>
          </div>
          <RadarMini lat={settings.lat} lon={settings.lon} onOpenRadar={onOpenRadar} />
        </div>

        {hourly && (
          <div className="hm-section">
            <div className="hm-section-title">⏱ Hourly Forecast</div>
            <HourlyRow hourly={hourly} units={settings.units} />
          </div>
        )}

        {daily && <DailyForecast daily={daily} units={settings.units} isDesktop={false} />}

        {daily && (
          <div className="hm-section">
            <div className="hm-section-title">☀️ Sun &amp; Daylight</div>
            <SunMoonBlock daily={daily} />
          </div>
        )}

        <div className="hm-section">
          <div className="hm-section-title">📊 Current Conditions</div>
          <div className="hm-stat-grid">
            <StatCard icon="💨" label="Wind" value={`${Math.round(c.wind_speed_10m)} ${windUnit}`} sub={`${windDir(c.wind_direction_10m)} · ${windDir(c.wind_direction_10m)}`} accent="#38bdf8" />
            <StatCard icon="💧" label="Humidity" value={`${c.relative_humidity_2m}%`} sub={humidityLabel(c.relative_humidity_2m)} accent="#7dd3fc" />
            {c.surface_pressure != null && (
              <StatCard icon="🧭" label="Pressure" value={`${Math.round(c.surface_pressure)} hPa`} sub={pressureTrend(c.surface_pressure)} accent="#a78bfa" />
            )}
            {uv != null && (
              <StatCard icon="🌤" label="UV Index" value={String(uv)} sub={uvLabel(uv)} subColor={uvColor(uv)} accent={uvColor(uv)} />
            )}
            {daily?.precipitation_sum?.[0] != null && (
              <StatCard icon="🌧" label="Precip Today" value={`${daily.precipitation_sum[0] ?? 0} ${settings.units === 'imperial' ? 'in' : 'mm'}`} sub="Accumulated" accent="#38bdf8" />
            )}
            {daily?.wind_speed_10m_max?.[0] != null && (
              <StatCard icon="💨" label="Wind Max" value={`${Math.round(daily.wind_speed_10m_max[0])} ${windUnit}`} sub="Today's peak" accent="#f97316" />
            )}
          </div>
        </div>

        {daily?.precipitation_probability_max && (
          <div className="hm-section">
            <div className="hm-section-title">🌧 Rain Chance — Next 7 Days</div>
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
          <div className="hm-section-title">🧭 Wind Details</div>
          <WindSection c={c} daily={daily} windUnit={windUnit} />
        </div>

        {isNws && hourly && <NwsExtras weatherData={weatherData} units={settings.units} />}
                <div className="hm-section">
          <div className="hm-section-title">🌡 Feels Like</div>
          <FeelsLikeSection c={c} tempUnit={tempUnit} />
        </div>

        <div className="hm-section">
          <div className="hm-section-title">💧 Dew Point</div>
          <DewPointSection c={c} tempUnit={tempUnit} />
        </div>

        <div className="hm-section">
          <div className="hm-section-title">🧭 Pressure Detail</div>
          <PressureSection c={c} hourly={hourly} />
        </div>

        {uv != null && (
          <div className="hm-section">
            <div className="hm-section-title">🌤 UV Index</div>
            <UvSection uv={uv} />
          </div>
        )}

        <div className="hm-bottom-bar">
          <span>{isNws ? '📡 National Weather Service' : '🌍 Open-Meteo'}</span>
          <span>{settings.units === 'imperial' ? '°F · mph · in' : '°C · km/h · mm'}</span>
        </div>

        <button className="hm-open-radar-cta" onClick={onOpenRadar}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M20.07 3.93a10 10 0 0 1 0 16.14M3.93 20.07a10 10 0 0 1 0-16.14"/>
          </svg>
          Open Full Radar Experience
        </button>

      </div>
      <AlertModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
    </div>
  )
}