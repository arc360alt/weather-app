import {
  AreaChart, Area,
  BarChart, Bar,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from 'recharts'

const COLORS = {
  temperature:   '#f97316',
  precipitation: '#38bdf8',
  wind:          '#a78bfa',
}

function formatHour(isoString) {
  const d = new Date(isoString)
  const h = d.getHours()
  if (h === 0)  return '12am'
  if (h === 12) return '12pm'
  return h > 12 ? `${h - 12}pm` : `${h}am`
}

function formatDay(isoString) {
  const [year, month, day] = isoString.split('T')[0].split('-').map(Number)
  const d = new Date(year, month - 1, day) // local midnight — no UTC shift
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Returns true if an array has at least one non-null, finite value
function hasData(arr) {
  return Array.isArray(arr) && arr.some(v => v != null && isFinite(v))
}

export function HourlyChart({ data, units, chartType = 'temperature' }) {
  if (!data?.hourly) return null

  const { time, temperature_2m, precipitation_probability, precipitation, wind_speed_10m } = data.hourly

  const now = new Date()
  const startIdx = time.findIndex(t => new Date(t) >= now)
  const slice = (arr) => arr.slice(startIdx, startIdx + 24)

  const chartData = slice(time).map((t, i) => ({
    time:         formatHour(t),
    temperature:  slice(temperature_2m)[i],
    precipChance: slice(precipitation_probability)[i],
    precip:       slice(precipitation)[i],
    wind:         slice(wind_speed_10m)[i],
  }))

  const tempUnit = units === 'imperial' ? '°F' : '°C'
  const windUnit = units === 'imperial' ? 'mph' : 'km/h'
  const precipUnit = units === 'imperial' ? 'in' : 'mm'
  const tick    = { fill: '#94a3b8', fontSize: 10 }
  const tooltip = { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }

  if (chartType === 'temperature') return (
    <div>
      <p className="chart-label">Hourly Temperature ({tempUnit})</p>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={COLORS.temperature} stopOpacity={0.4} />
              <stop offset="95%" stopColor={COLORS.temperature} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="time" tick={tick} interval={3} />
          <YAxis tick={tick} />
          <Tooltip contentStyle={tooltip} labelStyle={{ color: '#94a3b8' }} itemStyle={{ color: COLORS.temperature }} formatter={v => [`${v}${tempUnit}`, 'Temp']} />
          <Area type="monotone" dataKey="temperature" stroke={COLORS.temperature} strokeWidth={2} fill="url(#tempGrad)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )

  if (chartType === 'precipitation') return (
    <div>
      <p className="chart-label">Hourly Precipitation Chance (%)</p>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="time" tick={tick} interval={3} />
          <YAxis tick={tick} domain={[0, 100]} />
          <Tooltip contentStyle={tooltip} labelStyle={{ color: '#94a3b8' }} itemStyle={{ color: COLORS.precipitation }} formatter={v => [`${v}%`, 'Precip Chance']} />
          <Bar dataKey="precipChance" fill={COLORS.precipitation} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )

  if (chartType === 'wind') return (
    <div>
      <p className="chart-label">Hourly Wind Speed ({windUnit})</p>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="time" tick={tick} interval={3} />
          <YAxis tick={tick} />
          <Tooltip contentStyle={tooltip} labelStyle={{ color: '#94a3b8' }} itemStyle={{ color: COLORS.wind }} formatter={v => [`${v} ${windUnit}`, 'Wind']} />
          <Line type="monotone" dataKey="wind" stroke={COLORS.wind} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )

  return null
}

export function WeeklyChart({ data, units, chartType = 'temperature' }) {
  if (!data?.daily) return null

  const {
    time,
    temperature_2m_max,
    temperature_2m_min,
    precipitation_sum,
    precipitation_probability_max,
    wind_speed_10m_max,
    wind_speed_10m_min,
  } = data.daily

  const tempUnit  = units === 'imperial' ? '°F' : '°C'
  const windUnit  = units === 'imperial' ? 'mph' : 'km/h'
  const precipUnit = units === 'imperial' ? 'in' : 'mm'
  const tick    = { fill: '#94a3b8', fontSize: 10 }
  const tooltip = { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }

  // ── Temperature (always available) ──────────────────────────────────────────
  if (chartType === 'temperature') {
    const chartData = time.map((t, i) => ({
      day: formatDay(t),
      max: temperature_2m_max[i],
      min: temperature_2m_min[i],
    }))

    return (
      <div>
        <p className="chart-label">7-Day High / Low ({tempUnit})</p>
        <ResponsiveContainer width="100%" height={130}>
          <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="day" tick={tick} />
            <YAxis tick={tick} />
            <Tooltip contentStyle={tooltip} labelStyle={{ color: '#94a3b8' }} />
            <Line type="monotone" dataKey="max" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} name="High" />
            <Line type="monotone" dataKey="min" stroke="#38bdf8" strokeWidth={2} dot={{ r: 3 }} name="Low" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    )
  }

  // ── Precipitation ────────────────────────────────────────────────────────────
  if (chartType === 'precipitation') {
    // Prefer precipitation_sum; fall back to precipitation_probability_max
    const hasPrecipSum  = hasData(precipitation_sum)
    const hasPrecipProb = hasData(precipitation_probability_max)

    if (!hasPrecipSum && !hasPrecipProb) return null // provider doesn't support it

    if (hasPrecipSum) {
      const chartData = time.map((t, i) => ({
        day:    formatDay(t),
        precip: precipitation_sum[i] ?? 0,
      }))
      return (
        <div>
          <p className="chart-label">7-Day Precipitation ({precipUnit})</p>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="day" tick={tick} />
              <YAxis tick={tick} />
              <Tooltip
                contentStyle={tooltip}
                labelStyle={{ color: '#94a3b8' }}
                itemStyle={{ color: COLORS.precipitation }}
                formatter={v => [`${v} ${precipUnit}`, 'Precip']}
              />
              <Bar dataKey="precip" fill={COLORS.precipitation} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )
    }

    // Fallback: show probability bars when sum isn't available
    const chartData = time.map((t, i) => ({
      day:          formatDay(t),
      precipChance: precipitation_probability_max[i] ?? 0,
    }))
    return (
      <div>
        <p className="chart-label">7-Day Precipitation Chance (%)</p>
        <ResponsiveContainer width="100%" height={130}>
          <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="day" tick={tick} />
            <YAxis tick={tick} domain={[0, 100]} />
            <Tooltip
              contentStyle={tooltip}
              labelStyle={{ color: '#94a3b8' }}
              itemStyle={{ color: COLORS.precipitation }}
              formatter={v => [`${v}%`, 'Precip Chance']}
            />
            <Bar dataKey="precipChance" fill={COLORS.precipitation} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    )
  }

  // ── Wind ─────────────────────────────────────────────────────────────────────
  if (chartType === 'wind') {
    if (!hasData(wind_speed_10m_max)) return null // provider doesn't support it

    const hasMin = hasData(wind_speed_10m_min)

    const chartData = time.map((t, i) => ({
      day:    formatDay(t),
      windMax: wind_speed_10m_max[i] ?? 0,
      windMin: hasMin ? (wind_speed_10m_min[i] ?? 0) : undefined,
    }))

    return (
      <div>
        <p className="chart-label">7-Day Wind Speed ({windUnit})</p>
        <ResponsiveContainer width="100%" height={130}>
          <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="day" tick={tick} />
            <YAxis tick={tick} />
            <Tooltip
              contentStyle={tooltip}
              labelStyle={{ color: '#94a3b8' }}
              formatter={(v, name) => [`${v} ${windUnit}`, name === 'windMax' ? 'Max' : 'Min']}
            />
            <Line type="monotone" dataKey="windMax" stroke={COLORS.wind} strokeWidth={2} dot={{ r: 3 }} name="windMax" />
            {hasMin && (
              <Line type="monotone" dataKey="windMin" stroke="#c4b5fd" strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3 }} name="windMin" />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    )
  }

  return null
}
