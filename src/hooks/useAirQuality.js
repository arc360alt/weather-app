import { useState, useEffect } from 'react'

const API_KEY = import.meta.env.VITE_GOOGLE_POLLEN_KEY

export function aqiInfo(aqi) {
  if (aqi == null) return { label: 'N/A', color: '#6b8db5' }
  if (aqi <= 50)  return { label: 'Good',                   color: '#22c55e' }
  if (aqi <= 100) return { label: 'Moderate',               color: '#eab308' }
  if (aqi <= 150) return { label: 'Unhealthy (Sensitive)',   color: '#f97316' }
  if (aqi <= 200) return { label: 'Unhealthy',              color: '#ef4444' }
  if (aqi <= 300) return { label: 'Very Unhealthy',         color: '#a855f7' }
  return                  { label: 'Hazardous',             color: '#be123c' }
}

function getPollutant(pollutants, code) {
  return pollutants?.find(p => p.code === code)?.concentration?.value ?? null
}

export function useAirQuality(lat, lon) {
  const [data, setData] = useState(null)

  useEffect(() => {
    if (lat == null || lon == null || !API_KEY) { setData(null); return }
    fetch(
      `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${encodeURIComponent(API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: { latitude: lat, longitude: lon },
          extraComputations: ['LOCAL_AQI', 'POLLUTANT_CONCENTRATION'],
        }),
      }
    )
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (!json) { setData(null); return }
        const usIndex = json.indexes?.find(i => i.code === 'usa_epa') ?? json.indexes?.[0]
        const aqi = usIndex?.aqi ?? null
        const pollutants = json.pollutants
        setData({
          aqi,
          ...aqiInfo(aqi),
          category: usIndex?.category ?? null,
          dominant: json.indexes?.find(i => i.dominantPollutant)?.dominantPollutant ?? null,
          pm25: getPollutant(pollutants, 'pm25'),
          pm10: getPollutant(pollutants, 'pm10'),
          no2:  getPollutant(pollutants, 'no2'),
          o3:   getPollutant(pollutants, 'o3'),
        })
      })
      .catch(() => setData(null))
  }, [lat, lon])

  return data
}
