import { useState, useEffect } from 'react'

const API_KEY = import.meta.env.VITE_GOOGLE_POLLEN_KEY

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
    if (lat == null || lon == null || !API_KEY) { setData(null); return }
    fetch(
      `https://pollen.googleapis.com/v1/forecast:lookup` +
      `?key=${encodeURIComponent(API_KEY)}&location.latitude=${lat}&location.longitude=${lon}&days=5`
    )
      .then(r => r.ok ? r.json() : null)
      .then(json => setData(json ? parse(json) : null))
      .catch(() => setData(null))
  }, [lat, lon])

  return data
}
