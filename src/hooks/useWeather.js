import { useState, useEffect, useCallback } from 'react'

function nwsForecastToWmo(text) {
  if (!text) return 0
  const t = text.toLowerCase()
  if (t.includes('thunder'))                                          return 95
  if (t.includes('blizzard') || t.includes('heavy snow'))            return 75
  if (t.includes('snow') && t.includes('sleet'))                     return 77
  if (t.includes('sleet'))                                           return 77
  if (t.includes('snow shower') || t.includes('snow showers'))       return 85
  if (t.includes('snow'))                                            return 73
  if (t.includes('flurries'))                                        return 71
  if (t.includes('freezing rain') || t.includes('freezing drizzle')) return 67
  if (t.includes('heavy rain'))                                      return 65
  if (t.includes('rain') && t.includes('shower'))                    return 80
  if (t.includes('shower'))                                          return 80
  if (t.includes('rain'))                                            return 63
  if (t.includes('drizzle'))                                         return 51
  if (t.includes('fog') || t.includes('haze') || t.includes('smoke')) return 45
  if ((t.includes('cloudy') || t.includes('overcast')) &&
      !t.includes('partly') && !t.includes('mostly'))               return 3
  if (t.includes('mostly cloudy') || t.includes('considerable'))    return 2
  if (t.includes('partly cloudy') || t.includes('partly sunny'))    return 1
  if (t.includes('sunny') || t.includes('clear'))                   return 0
  return 0
}

function toLocalIso(iso) { return iso.slice(0, 16) }
function localDateKey(iso) { return iso.slice(0, 10) }

function obsWindToDisplay(value, unitCode, units) {
  if (value == null || isNaN(value)) return null
  const kmh = (unitCode || '').includes('m_s-1') ? value * 3.6 : value
  return units === 'imperial'
    ? Math.round(kmh / 1.60934 * 10) / 10
    : Math.round(kmh * 10) / 10
}

function expandGridSeries(values) {
  const map = new Map()
  for (const { validTime, value } of values) {
    if (value == null) continue
    const [isoStart, duration] = validTime.split('/')
    const start = new Date(isoStart)
    const hours = parseInt(duration.match(/PT?(\d+)H/)?.[1] ?? '1')
    for (let i = 0; i < hours; i++) {
      const d = new Date(start.getTime() + i * 3600000)
      const key = d.toISOString().slice(0, 13)
      map.set(key, value)
    }
  }
  return map
}

function dailyPrecipSumFromGrid(values, localDateKeys, timeZone, toDisplayUnit) {
  const sumByDate = new Map()
  for (const { validTime, value } of values) {
    if (value == null || value === 0) continue
    const [isoStart, duration] = validTime.split('/')
    const utcDate = new Date(isoStart)
    const hours = parseInt(duration.match(/PT?(\d+)H/)?.[1] ?? '1')
    const totalMm = value * hours
    let localDate
    try {
      localDate = utcDate.toLocaleDateString('en-CA', { timeZone })
    } catch {
      localDate = utcDate.toISOString().slice(0, 10)
    }
    sumByDate.set(localDate, (sumByDate.get(localDate) ?? 0) + totalMm)
  }
  return localDateKeys.map(d => {
    const raw = sumByDate.get(d)
    return raw != null ? Math.round(toDisplayUnit(raw) * 100) / 100 : 0
  })
}

function dailyMaxFromHourlyMap(hourlyMap, localDateKeys, timeZone) {
  const maxByDate = new Map()
  for (const [utcHourKey, value] of hourlyMap) {
    const utcDate = new Date(`${utcHourKey}:00:00Z`)
    let localDate
    try {
      localDate = utcDate.toLocaleDateString('en-CA', { timeZone })
    } catch {
      localDate = utcDate.toISOString().slice(0, 10)
    }
    if (!maxByDate.has(localDate) || value > maxByDate.get(localDate)) {
      maxByDate.set(localDate, value)
    }
  }
  return localDateKeys.map(d => maxByDate.get(d) ?? null)
}

function dailyMinFromHourlyMap(hourlyMap, localDateKeys, timeZone) {
  const minByDate = new Map()
  for (const [utcHourKey, value] of hourlyMap) {
    const utcDate = new Date(`${utcHourKey}:00:00Z`)
    let localDate
    try {
      localDate = utcDate.toLocaleDateString('en-CA', { timeZone })
    } catch {
      localDate = utcDate.toISOString().slice(0, 10)
    }
    if (!minByDate.has(localDate) || value < minByDate.get(localDate)) {
      minByDate.set(localDate, value)
    }
  }
  return localDateKeys.map(d => minByDate.get(d) ?? null)
}

function approxSunriseSunset(dateStr, lat, lon, timeZone) {
  const [year, month, day] = dateStr.split('-').map(Number)
  // Correct Gregorian leap year rule
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 1 : 0
  const N = Math.floor(275 * month / 9) - Math.floor((month + 9) / 12) * (2 - leap) + day - 30
  const latRad = (lat * Math.PI) / 180
  const D = 23.45 * Math.sin(((360 / 365) * (N - 81) * Math.PI) / 180)
  const cosH = -Math.tan(latRad) * Math.tan((D * Math.PI) / 180)
  const H = cosH < -1 ? 180 : cosH > 1 ? 0 : (Math.acos(cosH) * 180) / Math.PI
  const solarNoonUtc = 12 - lon / 15
  const sunriseUtc = solarNoonUtc - H / 15
  const sunsetUtc  = solarNoonUtc + H / 15
  let utcOffsetHours = 0
  try {
    const midnight = new Date(`${dateStr}T12:00:00Z`)
    const localHour = parseInt(
      new Date(midnight).toLocaleString('en-US', { timeZone, hour: '2-digit', hour12: false })
    )
    utcOffsetHours = ((localHour - 12 + 36) % 24) - 12
  } catch { utcOffsetHours = Math.round(lon / 15) }
  const toIso = (utcH) => {
    const w = (((utcH + utcOffsetHours) % 24) + 24) % 24
    const hh = Math.floor(w), mm = Math.floor((w - hh) * 60)
    return `${dateStr}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`
  }
  return { sunrise: toIso(sunriseUtc), sunset: toIso(sunsetUtc) }
}

async function fetchOpenMeteo(lat, lon, units) {
  const tempUnit   = units === 'imperial' ? 'fahrenheit' : 'celsius'
  const windUnit   = units === 'imperial' ? 'mph'        : 'kmh'
  const precipUnit = units === 'imperial' ? 'inch'       : 'mm'
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,` +
    `wind_direction_10m,relative_humidity_2m,precipitation,surface_pressure,uv_index` +
    `&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,weather_code` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,` +
    `precipitation_probability_max,wind_speed_10m_max,wind_speed_10m_min,sunrise,sunset,uv_index_max` +
    `&temperature_unit=${tempUnit}&wind_speed_unit=${windUnit}&precipitation_unit=${precipUnit}` +
    `&forecast_days=8&timezone=auto`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`)
  const json = await r.json()

  const hourly    = json.hourly
  const dailyTime = json.daily.time
  const tz        = json.timezone

  let precipProbMin = dailyTime.map(() => null)
  if (hourly?.precipitation_probability && hourly?.time) {
    const probMap = new Map()
    hourly.time.forEach((t, i) => {
      const v = hourly.precipitation_probability[i]
      if (v == null) return
      probMap.set(new Date(t).toISOString().slice(0, 13), v)
    })
    precipProbMin = dailyMinFromHourlyMap(probMap, dailyTime, tz)
  }

  json.daily.precipitation_probability_min = precipProbMin
  return json
}

async function fetchBestObservation(stationsUrl, headers) {
  if (!stationsUrl) return null
  try {
    const res = await fetch(`${stationsUrl}?limit=5`, { headers })
    if (!res.ok) return null
    const stations = (await res.json()).features ?? []
    for (const station of stations) {
      const id = station.properties?.stationIdentifier
      if (!id) continue
      try {
        const r = await fetch(`https://api.weather.gov/stations/${id}/observations/latest`, { headers })
        if (!r.ok) continue
        const p = (await r.json()).properties
        if (p?.windSpeed?.value != null) return p
      } catch { /* try next */ }
    }
  } catch { /* fall through */ }
  return null
}

async function fetchNWS(lat, lon, units) {
  const headers = { 'User-Agent': 'WeatherApp/1.0', 'Accept': 'application/geo+json' }

  const pointsRes = await fetch(
    `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
    { headers }
  )
  if (!pointsRes.ok) {
    if (pointsRes.status === 404)
      throw new Error('National Weather Service only covers the United States. Switch to Open-Meteo for other locations.')
    throw new Error(`NWS lookup failed (HTTP ${pointsRes.status})`)
  }

  const {
    forecastHourly: hourlyUrl, forecast: dailyUrl,
    forecastGridData: gridUrl, observationStations: stationsUrl, timeZone,
  } = (await pointsRes.json()).properties

  if (!hourlyUrl || !dailyUrl) throw new Error('NWS did not return forecast URLs.')

  const [hourlyRes, dailyRes, gridRes, obsProps] = await Promise.all([
    fetch(hourlyUrl, { headers }),
    fetch(dailyUrl,  { headers }),
    gridUrl ? fetch(gridUrl, { headers }) : Promise.resolve(null),
    fetchBestObservation(stationsUrl, headers),
  ])

  if (!hourlyRes.ok) throw new Error(`NWS hourly failed (HTTP ${hourlyRes.status})`)
  if (!dailyRes.ok)  throw new Error(`NWS daily failed (HTTP ${dailyRes.status})`)

  const hourlyPeriods = (await hourlyRes.json()).properties?.periods
  const dailyPeriods  = (await dailyRes.json()).properties?.periods

  if (!hourlyPeriods?.length) throw new Error('NWS returned no hourly data.')
  if (!dailyPeriods?.length)  throw new Error('NWS returned no daily data.')

  let gridWindMap   = null
  let gridQPFValues = null

  if (gridRes?.ok) {
    try {
      const gridData = await gridRes.json()
      const props = gridData.properties ?? {}
      if (props.windSpeed?.values?.length)
        gridWindMap = expandGridSeries(props.windSpeed.values)
      if (props.quantitativePrecipitation?.values?.length)
        gridQPFValues = props.quantitativePrecipitation.values
    } catch { /* non-fatal */ }
  }

  const gridWindToDisplay = (kmh) => units === 'imperial'
    ? Math.round(kmh / 1.60934 * 10) / 10
    : Math.round(kmh * 10) / 10

  const hourlyTime = [], hourlyTemp = [], hourlyPrecipProb = []
  const hourlyPrecip = [], hourlyWind = [], hourlyWeatherCode = [], hourlyHumidity = []

  for (const p of hourlyPeriods) {
    hourlyTime.push(toLocalIso(p.startTime))
    const tempF = p.temperature
    hourlyTemp.push(units === 'imperial' ? tempF : Math.round((tempF - 32) * 5 / 9 * 10) / 10)
    hourlyPrecipProb.push(p.probabilityOfPrecipitation?.value ?? 0)
    hourlyPrecip.push(0)

    const utcHourKey = new Date(p.startTime).toISOString().slice(0, 13)
    const gridKmh = gridWindMap?.get(utcHourKey)
    hourlyWind.push(gridKmh != null
      ? gridWindToDisplay(gridKmh)
      : (units === 'imperial'
          ? parseInt(p.windSpeed) || 0
          : Math.round((parseInt(p.windSpeed) || 0) * 1.60934))
    )

    hourlyWeatherCode.push(nwsForecastToWmo(p.shortForecast))
    hourlyHumidity.push(p.relativeHumidity?.value ?? null)
  }

  const firstP = hourlyPeriods[0]

  let currentTemp = hourlyTemp[0]
  if (obsProps?.temperature?.value != null) {
    const c = obsProps.temperature.value
    currentTemp = units === 'imperial' ? Math.round(c * 9 / 5 + 32) : Math.round(c * 10) / 10
  }

  let currentFeelsLike = currentTemp
  const flC = obsProps?.heatIndex?.value ?? obsProps?.windChill?.value
  if (flC != null)
    currentFeelsLike = units === 'imperial' ? Math.round(flC * 9 / 5 + 32) : Math.round(flC * 10) / 10

  let currentWind = hourlyWind[0]
  if (obsProps?.windSpeed?.value != null)
    currentWind = obsWindToDisplay(obsProps.windSpeed.value, obsProps.windSpeed.unitCode, units) ?? currentWind

  const cardinalToDeg = {
    N:0,NNE:22,NE:45,ENE:67,E:90,ESE:112,SE:135,SSE:157,
    S:180,SSW:202,SW:225,WSW:247,W:270,WNW:292,NW:315,NNW:337,
  }
  const currentWindDir = obsProps?.windDirection?.value
    ?? cardinalToDeg[firstP.windDirection ?? 'N'] ?? 0

  let currentHumidity = hourlyHumidity[0] ?? 0
  if (obsProps?.relativeHumidity?.value != null)
    currentHumidity = Math.round(obsProps.relativeHumidity.value)

  const currentPressure = obsProps?.barometricPressure?.value != null
    ? Math.round(obsProps.barometricPressure.value / 100)
    : null

  const currentWmo = obsProps?.textDescription
    ? nwsForecastToWmo(obsProps.textDescription)
    : hourlyWeatherCode[0]

  const dayMap = new Map()
  for (const p of dailyPeriods) {
    const key = localDateKey(toLocalIso(p.startTime))
    if (!dayMap.has(key)) dayMap.set(key, [])
    dayMap.get(key).push(p)
  }

  const dailyTime = [], dailyMax = [], dailyMin = []
  const dailyPrecipProbMax = [], dailyPrecipProbMin = []
  const dailyCode = [], dailySunrise = [], dailySunset = []

  for (const [dateKey, periods] of [...dayMap.entries()].sort(([a],[b]) => a < b ? -1 : 1)) {
    const dayP   = periods.find(p =>  p.isDaytime)
    const nightP = periods.find(p => !p.isDaytime)
    if (!dayP && !nightP) continue

    const toTemp = (f) => units === 'imperial' ? f : Math.round((f - 32) * 5 / 9 * 10) / 10
    dailyTime.push(dateKey)
    dailyMax.push(toTemp(dayP   ? dayP.temperature   : nightP.temperature + 10))
    dailyMin.push(toTemp(nightP ? nightP.temperature : dayP.temperature   - 15))

    const dayProb   = dayP?.probabilityOfPrecipitation?.value   ?? 0
    const nightProb = nightP?.probabilityOfPrecipitation?.value ?? 0
    dailyPrecipProbMax.push(Math.max(dayProb, nightProb))
    dailyPrecipProbMin.push(Math.min(dayProb, nightProb))

    dailyCode.push(Math.max(
      dayP   ? nwsForecastToWmo(dayP.shortForecast)   : 0,
      nightP ? nwsForecastToWmo(nightP.shortForecast) : 0
    ))
    const { sunrise, sunset } = approxSunriseSunset(dateKey, lat, lon, timeZone)
    dailySunrise.push(sunrise)
    dailySunset.push(sunset)
  }

  let dailyWindMax = dailyTime.map(() => null)
  let dailyWindMin = dailyTime.map(() => null)
  if (gridWindMap) {
    const rawMaxKmh = dailyMaxFromHourlyMap(gridWindMap, dailyTime, timeZone)
    const rawMinKmh = dailyMinFromHourlyMap(gridWindMap, dailyTime, timeZone)
    dailyWindMax = rawMaxKmh.map(v => v != null ? gridWindToDisplay(v) : null)
    dailyWindMin = rawMinKmh.map(v => v != null ? gridWindToDisplay(v) : null)
  }

  let dailyPrecipSum = dailyTime.map(() => 0)
  if (gridQPFValues) {
    const mmToDisplay = (mm) => units === 'imperial'
      ? Math.round(mm / 25.4 * 100) / 100
      : Math.round(mm * 100) / 100
    dailyPrecipSum = dailyPrecipSumFromGrid(gridQPFValues, dailyTime, timeZone, mmToDisplay)
  }

  return {
    current: {
      temperature_2m:        currentTemp,
      apparent_temperature:  currentFeelsLike,
      weather_code:          currentWmo,
      wind_speed_10m:        currentWind,
      wind_direction_10m:    currentWindDir,
      relative_humidity_2m:  currentHumidity,
      precipitation:         0,
      surface_pressure:      currentPressure,
      uv_index:              null,
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
      time:                          dailyTime,
      weather_code:                  dailyCode,
      temperature_2m_max:            dailyMax,
      temperature_2m_min:            dailyMin,
      precipitation_sum:             dailyPrecipSum,
      precipitation_probability_max: dailyPrecipProbMax,
      precipitation_probability_min: dailyPrecipProbMin,
      wind_speed_10m_max:            dailyWindMax,
      wind_speed_10m_min:            dailyWindMin,
      sunrise:                       dailySunrise,
      sunset:                        dailySunset,
      uv_index_max:                  dailyTime.map(() => null),
    },
  }
}

export function useWeather(lat, lon, units = 'metric', provider = 'openmeteo') {
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  useEffect(() => {
    if (lat == null || lon == null) return
    setLoading(true)
    setError(null)
    const promise = provider === 'nws'
      ? fetchNWS(lat, lon, units)
      : fetchOpenMeteo(lat, lon, units)
    promise
      .then(json => { setData(json); setLoading(false) })
      .catch(e   => { setError(e.message); setLoading(false) })
  }, [lat, lon, units, provider, refreshKey])

  return { data, loading, error, refresh }
}
