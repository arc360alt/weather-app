import { useState, useEffect } from 'react'
import { API_BASE } from '../config/api'

async function fetchGoogle(lat, lon) {
  const [curRes, fcRes] = await Promise.all([
    fetch(`${API_BASE}/google/weather-current?lat=${lat}&lon=${lon}`),
    fetch(`${API_BASE}/google/weather-forecast?lat=${lat}&lon=${lon}&hours=24`),
  ])
  const cur = curRes.ok ? await curRes.json() : null
  const fc  = fcRes.ok  ? await fcRes.json()  : null
  if (!cur) return null

  const timezone   = cur.timeZone?.id ?? 'UTC'
  const chartHours = fc?.forecastHours ?? []
  return {
    currentCloudCover: cur.cloudCover ?? null,
    chartValues:  chartHours.map(h => h.cloudCover ?? 0),
    chartTimes:   chartHours.map(h => h.interval?.startTime ?? ''),
    timezone,
  }
}

function locationHourIndex(times, utcOffsetSeconds) {
  if (!times?.length) return 0
  const locationMs = Date.now() + utcOffsetSeconds * 1000
  const d = new Date(locationMs)
  const pad = n => String(n).padStart(2, '0')
  const hourStr =
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:00`
  const exact = times.findIndex(t => t === hourStr)
  return exact !== -1 ? exact : Math.max(0, times.findLastIndex(t => t <= hourStr))
}

async function fetchOpenMeteo(lat, lon) {
  const res  = await fetch(
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=cloud_cover&timezone=auto&forecast_days=2`
  )
  const json = res.ok ? await res.json() : null
  if (!json?.hourly) return null

  const utcOffset = json.utc_offset_seconds ?? 0
  const times     = json.hourly.time
  const values    = json.hourly.cloud_cover
  const curIdx    = locationHourIndex(times, utcOffset)
  return {
    currentCloudCover: values[curIdx] ?? null,
    chartValues:  values.slice(curIdx + 1, curIdx + 25),
    chartTimes:   times.slice(curIdx + 1, curIdx + 25),
    timezone:     json.timezone ?? 'UTC',
  }
}

export function useCloudCover(lat, lon) {
  const [data, setData] = useState(null)

  useEffect(() => {
    if (lat == null || lon == null) { setData(null); return }
    let cancelled = false

    fetchGoogle(lat, lon)
      .then(d => d ?? fetchOpenMeteo(lat, lon))
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => {
        if (!cancelled) fetchOpenMeteo(lat, lon).then(d => setData(d)).catch(() => setData(null))
      })

    return () => { cancelled = true }
  }, [lat, lon])

  return data
}
