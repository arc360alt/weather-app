import pLimit from 'p-limit'
import { decodePng, pngToGray, composeTileGrid } from './image.js'
import { tileRangeForBbox } from './tileMath.js'
import { config } from '../config.js'

const tileConcurrency = pLimit(config.tileFetchConcurrency)

function padMins(mins) {
  return String(mins).padStart(2, '0')
}

function layerNameForAge(ageMinutes) {
  if (ageMinutes <= 0) return 'nexrad-n0q'
  return `nexrad-n0q-m${padMins(ageMinutes)}m`
}

function frameAges(historySteps, stepMinutes) {
  const out = []
  for (let i = historySteps - 1; i >= 0; i -= 1) {
    out.push(i * stepMinutes)
  }
  return out
}

async function fetchTile(base, layerName, z, x, y) {
  const url = `${base}/${layerName}/${z}/${x}/${y}.png`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'storm-nowcast-api/0.1' } })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.toLowerCase().includes('image/png')) return null
    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    if (buffer.length < 32) return null
    const png = await decodePng(buffer)
    return {
      rgba: png.data,
      gray: pngToGray(png.data),
      width: png.width,
      height: png.height,
    }
  } catch {
    return null
  }
}

export async function fetchRadarHistory({ tileBase, bbox, zoom, tileSize, historySteps, stepMinutes }) {
  const range = tileRangeForBbox(bbox, zoom)
  const cols = range.maxX - range.minX + 1
  const rows = range.maxY - range.minY + 1
  const ages = frameAges(historySteps, stepMinutes)

  // Fetch all time steps concurrently — previously sequential, which made every
  // step wait for the previous one's full tile batch before starting its own.
  const frames = await Promise.all(ages.map(async (age) => {
    const layerName = layerNameForAge(age)
    const tilePromises = []
    for (let y = range.minY; y <= range.maxY; y += 1) {
      for (let x = range.minX; x <= range.maxX; x += 1) {
        tilePromises.push(tileConcurrency(() => fetchTile(tileBase, layerName, zoom, x, y)))
      }
    }

    const tiles = await Promise.all(tilePromises)
    const composed = composeTileGrid(tiles, cols, rows, tileSize)
    return {
      ageMinutes: age,
      layerName,
      validAt: new Date(Date.now() - age * 60_000).toISOString(),
      ...composed,
    }
  }))

  // Restore oldest-first order (Promise.all preserves input order but ages are oldest-first)
  return {
    frames,
    range,
    cols,
    rows,
    tileSize,
    zoom,
  }
}
