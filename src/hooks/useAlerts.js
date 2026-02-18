import { useState, useEffect } from 'react'

/**
 * useAlerts — fetches active NWS weather alerts for a lat/lon.
 * Uses the free api.weather.gov — no API key needed.
 * Only works for US locations (NWS coverage area).
 */
export function useAlerts(lat, lon) {
  const [alerts,  setAlerts]  = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    if (lat == null || lon == null) return

    setLoading(true)
    setError(null)

    fetch(
      `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,
      { headers: { 'User-Agent': 'StormView/1.0' } }
    )
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(json => {
        // GeoJSON FeatureCollection — each feature.properties is an alert
        setAlerts(json.features ?? [])
        setLoading(false)
      })
      .catch(e => {
        // Silently fail for non-US locations — just show no alerts
        setAlerts([])
        setError(e.message)
        setLoading(false)
      })
  }, [lat, lon])

  return { alerts, loading, error }
}