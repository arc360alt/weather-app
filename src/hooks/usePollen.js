import { useState, useEffect } from 'react'
import { API_BASE } from '../config/api'

function parse(json) {
  if (!json?.dailyInfo?.length) return null
  const get = (types, code) => types?.find(t => t.code === code) ?? null
  return {
    current: (() => {
      const day = json.dailyInfo[0]
      return {
        tree:  get(day.pollenTypeInfo, 'TREE'),
        grass: get(day.pollenTypeInfo, 'GRASS'),
        weed:  get(day.pollenTypeInfo, 'WEED'),
      }
    })(),
    forecast: json.dailyInfo.map(day => {
      const { year, month, day: d } = day.date
      return {
        date:  `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`,
        tree:  get(day.pollenTypeInfo, 'TREE'),
        grass: get(day.pollenTypeInfo, 'GRASS'),
        weed:  get(day.pollenTypeInfo, 'WEED'),
      }
    }),
  }
}

export function usePollen(lat, lon) {
  const [data, setData] = useState(null)

  useEffect(() => {
    if (lat == null || lon == null) { setData(null); return }
    fetch(`${API_BASE}/api/google/pollen?lat=${lat}&lon=${lon}&days=5`)
      .then(r => r.ok ? r.json() : null)
      .then(json => setData(json && !json.error ? parse(json) : null))
      .catch(() => setData(null))
  }, [lat, lon])

  return data
}
