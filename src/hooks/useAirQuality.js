import { useState, useEffect } from 'react'
import { API_BASE } from '../config/api'

export function aqiInfo(aqi) {
  if (aqi == null) return { label: 'N/A', color: '#6b8db5' }
  if (aqi <= 50)  return { label: 'Good',                   color: '#22c55e' }
  if (aqi <= 100) return { label: 'Moderate',               color: '#eab308' }
  if (aqi <= 150) return { label: 'Unhealthy (Sensitive)',   color: '#f97316' }
  if (aqi <= 200) return { label: 'Unhealthy',              color: '#ef4444' }
  if (aqi <= 300) return { label: 'Very Unhealthy',         color: '#a855f7' }
  return                  { label: 'Hazardous',             color: '#be123c' }
}

async function fetchGoogle(lat, lon) {
  const res = await fetch(`${API_BASE}/api/google/air-quality`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lon }),
  })
  if (!res.ok) return null
  const json = await res.json()
  if (json.error) return null
  const usIndex    = json.indexes?.find(i => i.code === 'usa_epa') ?? json.indexes?.[0]
  const aqi        = usIndex?.aqi ?? null
  const pollutants = json.pollutants
  const get = code => pollutants?.find(p => p.code === code)?.concentration?.value ?? null
  return { aqi, ...aqiInfo(aqi), pm25: get('pm25'), pm10: get('pm10'), no2: get('no2'), o3: get('o3') }
}

async function fetchOpenMeteo(lat, lon) {
  const res = await fetch(
    `https://air-quality-api.open-meteo.com/v1/air-quality` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=us_aqi,pm10,pm2_5,nitrogen_dioxide,ozone` +
    `&domains=cams_global`
  )
  if (!res.ok) return null
  const json = await res.json()
  if (!json?.current) return null
  const c = json.current
  const aqi = c.us_aqi ?? null
  return {
    aqi,
    ...aqiInfo(aqi),
    pm25: c.pm2_5            ?? null,
    pm10: c.pm10             ?? null,
    no2:  c.nitrogen_dioxide ?? null,
    o3:   c.ozone            ?? null,
  }
}

export function useAirQuality(lat, lon, provider = 'google') {
  const [data, setData] = useState(null)

  useEffect(() => {
    if (lat == null || lon == null) { setData(null); return }
    let cancelled = false

    const primary   = provider === 'google' ? fetchGoogle : fetchOpenMeteo
    const secondary = provider === 'google' ? fetchOpenMeteo : null

    primary(lat, lon)
      .then(d => {
        if (d) return d
        return secondary ? secondary(lat, lon) : null
      })
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setData(null) })

    return () => { cancelled = true }
  }, [lat, lon, provider])

  return data
}
