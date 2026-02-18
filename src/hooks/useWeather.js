import { useState, useEffect } from 'react'

/**
 * useWeather — fetches current conditions + hourly + 7-day forecast
 * from Open-Meteo (completely free, no API key needed).
 */
export function useWeather(lat, lon, units = 'metric') {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (lat == null || lon == null) return

    const tempUnit = units === 'metric' ? 'celsius' : 'fahrenheit'
    const windUnit = units === 'metric' ? 'kmh' : 'mph'
    const precipUnit = units === 'metric' ? 'mm' : 'inch'

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,` +
      `wind_direction_10m,relative_humidity_2m,precipitation,surface_pressure` +
      `&hourly=temperature_2m,precipitation_probability,precipitation,windspeed_10m,weather_code` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,` +
      `precipitation_probability_max,wind_speed_10m_max,sunrise,sunset,uv_index_max` +
      `&temperature_unit=${tempUnit}` +
      `&wind_speed_unit=${windUnit}` +
      `&precipitation_unit=${precipUnit}` +
      `&forecast_days=7` +
      `&timezone=auto`

    setLoading(true)
    setError(null)

    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(json => {
        setData(json)
        setLoading(false)
      })
      .catch(e => {
        setError(e.message)
        setLoading(false)
      })
  }, [lat, lon, units])

  return { data, loading, error }
}
