import pLimit from 'p-limit'
import { LRUCache } from 'lru-cache'
import { decodePng, pngToGray, composeTileGrid } from './image.js'
import { tileRangeForBbox } from './tileMath.js'
import { config } from '../config.js'

const tileConcurrency = pLimit(config.tileFetchConcurrency)

// ── Raw tile cache ────────────────────────────────────────────────────────────
// Stores the raw PNG buffer (not decoded RGBA) for each fetched tile.
// A decoded 256×256 RGBA tile = 262 KB; a typical IEM radar PNG = ~10-50 KB.
// At 400 entries the old decoded cache used ~130 MB; the buffer cache uses ~12 MB.
//
// History layers (age > 0) are immutable once IEM publishes them — keep them
// for 12 minutes.  The current layer (nexrad-n0q) changes every ~5 min so we
// cache it only 90 s to deduplicate burst requests without serving stale data.
// IEM history layers (e.g. nexrad-n0q-m10m) are ROLLING TIME POINTERS — IEM
// updates them every ~5 minutes so the same URL returns different data after
// each scan cycle.  Cache them for just under one NEXRAD update cycle (5 min)
// so they expire well before the next rebuild and we always read fresh scans.
const RAW_TILE_TTL_HISTORY_MS =  5 * 60 * 1000  // 5 min (one IEM scan cycle)
const RAW_TILE_TTL_CURRENT_MS =      90 * 1000  // 90 s  for nexrad-n0q
const rawTileCache = new LRUCache({ max: 400 })  // 400 × ~30 KB ≈ 12 MB

function rawTileKey(layerName, z, x, y) {
  return `${layerName}:${z}:${x}:${y}`
}

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

// Returns { tile, fromCache } — fromCache=true means no network request was made.
async function fetchTileCached(base, layerName, z, x, y, ageMinutes) {
  const key = rawTileKey(layerName, z, x, y)
  const cachedBuffer = rawTileCache.get(key)
  if (cachedBuffer) {
    // Re-decode from the cached PNG buffer.  Decode cost (~1 ms) is negligible
    // compared to the RAM saved by not keeping 262 KB decoded RGBA per entry.
    try {
      const png = await decodePng(cachedBuffer)
      return {
        tile: { rgba: png.data, gray: pngToGray(png.data), width: png.width, height: png.height },
        fromCache: true,
      }
    } catch {
      rawTileCache.delete(key)  // corrupt entry — force re-fetch
    }
  }

  const result = await _fetchTile(base, layerName, z, x, y)
  if (result) {
    const ttl = ageMinutes > 0 ? RAW_TILE_TTL_HISTORY_MS : RAW_TILE_TTL_CURRENT_MS
    rawTileCache.set(key, result.buffer, { ttl })  // cache only the raw buffer
  }
  return { tile: result?.tile ?? null, fromCache: false }
}

// Returns { buffer, tile } or null on failure.
async function _fetchTile(base, layerName, z, x, y) {
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
      buffer,   // kept for caching
      tile: { rgba: png.data, gray: pngToGray(png.data), width: png.width, height: png.height },
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
  // anyFresh tracks whether at least one tile came from the network (not raw cache).
  // If every tile was a cache hit the source data hasn't changed and callers can
  // skip the expensive motion-estimation + forecast rebuild.
  let anyFresh = false
  const frames = await Promise.all(ages.map(async (age) => {
    const layerName = layerNameForAge(age)
    const tilePromises = []
    for (let y = range.minY; y <= range.maxY; y += 1) {
      for (let x = range.minX; x <= range.maxX; x += 1) {
        tilePromises.push(
          tileConcurrency(() => fetchTileCached(tileBase, layerName, zoom, x, y, age)),
        )
      }
    }

    const results = await Promise.all(tilePromises)
    for (const r of results) { if (!r.fromCache) anyFresh = true }
    const tiles = results.map(r => r.tile)
    const composed = composeTileGrid(tiles, cols, rows, tileSize)
    return {
      ageMinutes: age,
      layerName,
      validAt: new Date(Date.now() - age * 60_000).toISOString(),
      ...composed,
    }
  }))

  return {
    frames,
    range,
    cols,
    rows,
    tileSize,
    zoom,
    anyFresh,
  }
}
