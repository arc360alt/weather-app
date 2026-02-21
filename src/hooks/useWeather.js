import { useState, useEffect, useCallback } from 'react'

// ── OWM weather code → WMO-style code mapping ────────────────────────────────
// OWM uses its own numeric IDs; we map them to the WMO codes WeatherPanel expects
function owmCodeToWmo(owmId) {
  if (owmId === 800) return 0                       // clear sky
  if (owmId === 801) return 1                       // few clouds
  if (owmId === 802) return 2                       // scattered clouds
  if (owmId >= 803)  return 3                       // broken/overcast
  if (owmId >= 700 && owmId < 800) return 45       // atmosphere (fog, haze…)
  if (owmId >= 600 && owmId < 700) {               // snow group
    if (owmId === 600 || owmId === 620) return 71
    if (owmId === 601 || owmId === 621) return 73
    if (owmId === 602 || owmId === 622) return 75
    return 71
  }
  if (owmId >= 500 && owmId < 600) {               // rain group
    if (owmId === 500) return 61
    if (owmId === 501) return 63
    if (owmId >= 502)  return 65
    if (owmId === 520) return 80
    if (owmId === 521) return 81
    if (owmId === 522) return 82
    return 61
  }
  if (owmId >= 300 && owmId < 400) return 51       // drizzle
  if (owmId >= 200 && owmId < 300) return 95       // thunderstorm
  return 0
}

// ── Fetch from Open-Meteo ────────────────────────────────────────────────────
async function fetchOpenMeteo(lat, lon, units) {
  const tempUnit   = units === 'metric' ? 'celsius'    : 'fahrenheit'
  const windUnit   = units === 'metric' ? 'kmh'        : 'mph'
  const precipUnit = units === 'metric' ? 'mm'         : 'inch'

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,` +
    `wind_direction_10m,relative_humidity_2m,precipitation,surface_pressure,uv_index` +
    `&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,weather_code` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,` +
    `precipitation_probability_max,wind_speed_10m_max,sunrise,sunset,uv_index_max` +
    `&temperature_unit=${tempUnit}` +
    `&wind_speed_unit=${windUnit}` +
    `&precipitation_unit=${precipUnit}` +
    `&forecast_days=7` +
    `&timezone=auto`

  const r = await fetch(url)
  if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`)
  return r.json()   // already in the shape WeatherPanel expects
}

// ── Fetch from OpenWeatherMap and normalise to Open-Meteo shape ──────────────
async function fetchOpenWeatherMap(lat, lon, units, apiKey) {
  if (!apiKey) throw new Error('No OpenWeatherMap API key set')

  const owmUnits = units === 'imperial' ? 'imperial' : 'metric'

  // Current weather + 5-day/3-hour forecast (free tier)
  const [currentRes, forecastRes] = await Promise.all([
    fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=${owmUnits}&appid=${apiKey}`),
    fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=${owmUnits}&cnt=56&appid=${apiKey}`),
  ])

  if (!currentRes.ok) {
    const body = await currentRes.json().catch(() => ({}))
    throw new Error(body.message ?? `OpenWeatherMap HTTP ${currentRes.status}`)
  }
  if (!forecastRes.ok) {
    const body = await forecastRes.json().catch(() => ({}))
    throw new Error(body.message ?? `OpenWeatherMap HTTP ${forecastRes.status}`)
  }

  const cur  = await currentRes.json()
  const fore = await forecastRes.json()

  const tempUnit = units === 'imperial' ? '°F' : '°C'  // unused but kept for parity

  // ── Build hourly arrays from 3-hour forecast list ──────────────────────────
  const hourlyTime             = []
  const hourlyTemp             = []
  const hourlyPrecipProb       = []
  const hourlyPrecip           = []
  const hourlyWind             = []
  const hourlyWeatherCode      = []

  for (const item of fore.list) {
    const iso = new Date(item.dt * 1000).toISOString()
    hourlyTime.push(iso)
    hourlyTemp.push(item.main.temp)
    hourlyPrecipProb.push(Math.round((item.pop ?? 0) * 100))
    hourlyPrecip.push(item.rain?.['3h'] ?? item.snow?.['3h'] ?? 0)
    hourlyWind.push(units === 'metric' ? item.wind.speed * 3.6 : item.wind.speed)  // m/s→km/h or mph
    hourlyWeatherCode.push(owmCodeToWmo(item.weather[0]?.id ?? 800))
  }

  // ── Build daily arrays by grouping 3-hour slots by date ───────────────────
  const dayMap = new Map()
  for (let i = 0; i < fore.list.length; i++) {
    const item    = fore.list[i]
    const dateKey = new Date(item.dt * 1000).toISOString().slice(0, 10)
    if (!dayMap.has(dateKey)) {
      dayMap.set(dateKey, {
        temps:   [],
        winds:   [],
        precips: [],
        pops:    [],
        codes:   [],
      })
    }
    const d = dayMap.get(dateKey)
    d.temps.push(item.main.temp_max ?? item.main.temp)
    d.temps.push(item.main.temp_min ?? item.main.temp)
    d.winds.push(item.wind.speed)
    d.precips.push(item.rain?.['3h'] ?? item.snow?.['3h'] ?? 0)
    d.pops.push(Math.round((item.pop ?? 0) * 100))
    d.codes.push(item.weather[0]?.id ?? 800)
  }

  const dailyTime           = []
  const dailyMax            = []
  const dailyMin            = []
  const dailyPrecipSum      = []
  const dailyPrecipProbMax  = []
  const dailyWindMax        = []
  const dailyCode           = []
  // OWM free tier has no sunrise/sunset in forecast — use current day's values
  const dailySunrise        = []
  const dailySunset         = []

  const sunriseIso = new Date(cur.sys.sunrise * 1000).toISOString()
  const sunsetIso  = new Date(cur.sys.sunset  * 1000).toISOString()

  for (const [date, d] of dayMap) {
    dailyTime.push(date)
    dailyMax.push(Math.max(...d.temps))
    dailyMin.push(Math.min(...d.temps))
    dailyPrecipSum.push(d.precips.reduce((a, b) => a + b, 0))
    dailyPrecipProbMax.push(Math.max(...d.pops))
    dailyWindMax.push(
      units === 'metric'
        ? Math.max(...d.winds) * 3.6
        : Math.max(...d.winds)
    )
    // Most common weather code for the day
    const freq = {}
    for (const c of d.codes) freq[c] = (freq[c] ?? 0) + 1
    const dominantId = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]
    dailyCode.push(owmCodeToWmo(Number(dominantId)))
    dailySunrise.push(sunriseIso)
    dailySunset.push(sunsetIso)
  }

  // ── Assemble into the same shape Open-Meteo returns ───────────────────────
  return {
    current: {
      temperature_2m:       cur.main.temp,
      apparent_temperature:  cur.main.feels_like,
      weather_code:          owmCodeToWmo(cur.weather[0]?.id ?? 800),
      wind_speed_10m:        units === 'metric' ? cur.wind.speed * 3.6 : cur.wind.speed,
      wind_direction_10m:    cur.wind.deg ?? 0,
      relative_humidity_2m:  cur.main.humidity,
      precipitation:         cur.rain?.['1h'] ?? cur.snow?.['1h'] ?? 0,
      surface_pressure:      cur.main.pressure,
      uv_index:              null,   // not in free OWM current endpoint
    },
    hourly: {
      time:                      hourlyTime,
      temperature_2m:            hourlyTemp,
      precipitation_probability: hourlyPrecipProb,
      precipitation:             hourlyPrecip,
      wind_speed_10m:            hourlyWind,
      weather_code:              hourlyWeatherCode,
    },
    daily: {
      time:                        dailyTime,
      weather_code:                dailyCode,
      temperature_2m_max:          dailyMax,
      temperature_2m_min:          dailyMin,
      precipitation_sum:           dailyPrecipSum,
      precipitation_probability_max: dailyPrecipProbMax,
      wind_speed_10m_max:          dailyWindMax,
      sunrise:                     dailySunrise,
      sunset:                      dailySunset,
      uv_index_max:                dailyTime.map(() => null),
    },
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useWeather(lat, lon, units = 'metric', provider = 'openmeteo', owmApiKey = '') {
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  useEffect(() => {
    if (lat == null || lon == null) return

    setLoading(true)
    setError(null)

    const promise = provider === 'openweathermap'
      ? fetchOpenWeatherMap(lat, lon, units, owmApiKey)
      : fetchOpenMeteo(lat, lon, units)

    promise
      .then(json => { setData(json); setLoading(false) })
      .catch(e   => { setError(e.message); setLoading(false) })

  }, [lat, lon, units, provider, owmApiKey, refreshKey])

  return { data, loading, error, refresh }
}
