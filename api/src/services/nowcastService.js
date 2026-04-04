import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { LRUCache } from 'lru-cache'
import { config } from '../config.js'
import { fetchRadarHistory } from '../lib/radarSource.js'
import { buildNowcastFrames } from '../lib/nowcast.js'
import { cropAndEncodeTile, encodeRgbaPng } from '../lib/image.js'
import { boundsForTileRange, tileCropBoundsInComposite } from '../lib/tileMath.js'

// ── Disk cache helpers ────────────────────────────────────────────────────────

const MANIFEST_PATH = join(config.tileCacheDir, 'nowcast', 'manifest.json')

function epochOf(generatedAt) {
  return Math.floor(new Date(generatedAt).getTime() / 1000)
}

function tileDiskPath(generatedAt, frameIndex, z, x, y) {
  const epoch = epochOf(generatedAt)
  return join(config.tileCacheDir, 'nowcast', 'tiles', String(epoch), String(frameIndex), String(z), `${x}-${y}.png`)
}

async function readTileFromDisk(path) {
  try { return await readFile(path) } catch { return null }
}

function writeTileToDisk(path, data) {
  // Fire-and-forget — a write failure must never break a tile response.
  mkdir(dirname(path), { recursive: true })
    .then(() => writeFile(path, data))
    .catch(() => {})
}

async function readManifest() {
  try { return JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) } catch { return null }
}

function writeManifest(data) {
  mkdir(dirname(MANIFEST_PATH), { recursive: true })
    .then(() => writeFile(MANIFEST_PATH, JSON.stringify(data)))
    .catch(() => {})
}

// Delete epoch tile directories older than one NEXRAD refresh cycle (10 min).
// Run after every build so disk usage stays bounded to a single epoch.
async function pruneOldEpochDirs(currentEpoch) {
  try {
    const tilesDir = join(config.tileCacheDir, 'nowcast', 'tiles')
    const entries = await readdir(tilesDir)
    const cutoffEpoch = currentEpoch - Math.ceil(config.nexradRefreshMs / 1000)
    for (const entry of entries) {
      const epoch = Number(entry)
      if (Number.isFinite(epoch) && epoch > 0 && epoch < cutoffEpoch) {
        rm(join(tilesDir, entry), { recursive: true, force: true }).catch(() => {})
      }
    }
  } catch { /* tilesDir may not exist yet */ }
}

// Pre-warm: render every tile within the composite's tileRange at its built zoom
// and write them to disk so all subsequent requests hit L2 (disk) instantly.
// Runs in background — does not block the response.
async function prewarmTiles(nowcast) {
  const { generatedAt, zoom, tileRange, frames } = nowcast
  const { minX, maxX, minY, maxY } = tileRange
  for (const frame of frames) {
    if (!frame.rgba) continue
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const memKey = `${generatedAt}:${frame.index}:${zoom}:${tx}:${ty}`
        if (tileCache.get(memKey)) continue
        const dPath = tileDiskPath(generatedAt, frame.index, zoom, tx, ty)
        try {
          const existing = await readTileFromDisk(dPath)
          if (existing) { tileCache.set(memKey, existing); continue }
          const cropBounds = tileCropBoundsInComposite(zoom, tx, ty, zoom, tileRange)
          const data = await cropAndEncodeTile(frame.rgba, frame.width, frame.height, cropBounds)
          tileCache.set(memKey, data)
          writeTileToDisk(dPath, data)
        } catch { /* non-fatal */ }
      }
    }
  }
}



function parseBbox(raw) {
  if (Array.isArray(raw) && raw.length === 4) {
    const nums = raw.map(Number)
    return nums.every(Number.isFinite) ? nums : null
  }
  if (typeof raw === 'string' && raw.trim()) {
    const parts = raw.split(',').map(Number)
    return parts.length === 4 && parts.every(Number.isFinite) ? parts : null
  }
  return null
}

function bboxKey(bbox) {
  return bbox.map(v => Math.round(v * 100) / 100).join(',')
}

// ── LRU caches (L1 in front of disk) ─────────────────────────────────────────

// On a constrained CPU keep only 1 active build in the nowcast cache.
// Viewport-bbox builds and full-US builds are small enough to share one slot.
const nowcastCache = new LRUCache({ max: 2, ttl: config.cacheTtlMs })
// Hot rendered 256×256 tile PNGs — avoids disk reads for recently hit tiles.
const tileCache = new LRUCache({ max: 600, ttl: config.cacheTtlMs })
// Full-frame PNGs used by image-source fallback mode.
const framePngCache = new LRUCache({ max: 48, ttl: config.cacheTtlMs })

// ── Service ───────────────────────────────────────────────────────────────────

export class NowcastService {
  constructor() {
    this.latest = null
    this.latestKey = null
    // Per-key pending promises so concurrent requests for different zoom/bbox
    // combos don't block or clobber each other.
    this._pending = new Map()
    this._refreshTimer = null
    this._updateListeners = []
  }

  /**
   * Call once before serving requests.  Restores the last build from disk so
   * tile requests are served instantly after a restart while a fresh build
   * runs in the background.
   */
  async init() {
    const manifest = await readManifest()
    if (!manifest) return

    const ageMs = Date.now() - new Date(manifest.generatedAt).getTime()
    // Only restore if the manifest is younger than 2 NEXRAD cycles (20 min)
    if (ageMs > 20 * 60 * 1000) return

    // Reconstruct a skeleton nowcast without RGBA — tiles will be served from disk.
    const skeleton = {
      ...manifest,
      frames: manifest.frames.map(f => ({ ...f, rgba: null, png: null })),
    }
    const key = `${manifest.minutesAhead}:${manifest.stepMinutes}:${manifest.zoom}:${bboxKey(manifest.usBbox)}`
    nowcastCache.set(key, skeleton)
    this.latest = skeleton
    this.latestKey = key
    console.log(`[NowcastService] Restored from disk (${manifest.generatedAt}, age ${Math.round(ageMs / 60000)} min)`)
  }

  /**
   * Start the proactive 10-minute rebuild timer.
   * If a fresh manifest was just restored, delays the first build until the
   * manifest's age reaches the refresh interval (avoids an immediate redundant build).
   */
  startAutoRefresh(options = {}) {
    const REFRESH_MS = config.nexradRefreshMs
    const refresh = async () => {
      try {
        const bbox = parseBbox(options.bbox) || config.usBbox
        const zoom = Math.min(config.maxNowcastZoom, Number(options.zoom) || config.radarZoom)
        const minutesAhead = Math.min(config.maxForecastMinutes, Number(options.minutesAhead) || config.maxForecastMinutes)
        const stepMinutes = Math.max(5, Number(options.stepMinutes) || config.stepMinutes)
        const key = `${minutesAhead}:${stepMinutes}:${zoom}:${bboxKey(bbox)}`
        // Invalidate the cached entry so _build runs unconditionally.
        nowcastCache.delete(key)
        await this.getNowcast({ ...options, zoom, bbox, minutesAhead, stepMinutes })
        console.log('[NowcastService] Auto-refresh complete')
      } catch (e) {
        console.error('[NowcastService] Auto-refresh failed:', e)
      }
    }

    // If the restored manifest is fresh, delay the first build so we don't
    // immediately invalidate perfectly good tiles.
    const ageMs = this.latest ? Date.now() - new Date(this.latest.generatedAt).getTime() : Infinity
    const firstDelay = Math.max(0, REFRESH_MS - ageMs)
    console.log(`[NowcastService] Next auto-refresh in ${Math.round(firstDelay / 60000)} min`)

    setTimeout(() => {
      refresh()
      this._refreshTimer = setInterval(refresh, REFRESH_MS)
    }, firstDelay)
  }

  stopAutoRefresh() {
    if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null }
  }

  async getNowcast(options = {}) {
    const minutesAhead = Math.min(
      config.maxForecastMinutes,
      Math.max(config.stepMinutes, Number(options.minutesAhead) || 60),
    )
    const stepMinutes = Math.max(5, Number(options.stepMinutes) || config.stepMinutes)
    const zoom = Math.min(config.maxNowcastZoom, Math.max(3, Number(options.zoom) || config.radarZoom))

    // Use the requested viewport bbox when provided; fall back to full US.
    const bbox = parseBbox(options.bbox) || config.usBbox

    const key = `${minutesAhead}:${stepMinutes}:${zoom}:${bboxKey(bbox)}`
    const cached = nowcastCache.get(key)
    if (cached) { this.latest = cached; return cached }

    // Deduplicate concurrent identical requests.
    const existing = this._pending.get(key)
    if (existing) return existing

    const promise = this._build({ minutesAhead, stepMinutes, zoom, bbox })
      .then(result => {
        nowcastCache.set(key, result)
        this.latest = result
        this.latestKey = key
        this._notifyListeners(result.generatedAt)
        return result
      })
      .finally(() => { this._pending.delete(key) })

    this._pending.set(key, promise)
    return promise
  }

  /**
   * Returns a rendered 256×256 tile PNG for the given frame + map tile coords.
   * Check order: memory LRU → disk → compute (then write both).
   */
  async getTile(frameIndex, z, x, y, options = {}) {
    // Resolve the exact nowcast composite matching this tile URL's zoom/bbox.
    const nowcast = (options.zoom != null || options.bbox != null)
      ? await this.getNowcast(options)
      : this.latest
    if (!nowcast) return null
    const frame = nowcast.frames[frameIndex]
    if (!frame) return null

    const memKey = `${nowcast.generatedAt}:${frameIndex}:${z}:${x}:${y}`

    // L1: memory LRU
    const memHit = tileCache.get(memKey)
    if (memHit) return memHit

    // L2: disk
    const dPath = tileDiskPath(nowcast.generatedAt, frameIndex, z, x, y)
    const diskHit = await readTileFromDisk(dPath)
    if (diskHit) {
      tileCache.set(memKey, diskHit)
      return diskHit
    }

    // L3: compute from RGBA.
    // rgba is null when serving a restored-from-disk skeleton; return null
    // (endpoint responds 503) until the background rebuild finishes.
    if (!frame.rgba) return null

    const crop = tileCropBoundsInComposite(z, x, y, nowcast.zoom, nowcast.tileRange)
    const data = await cropAndEncodeTile(frame.rgba, frame.width, frame.height, crop)
    tileCache.set(memKey, data)
    writeTileToDisk(dPath, data)
    return data
  }

  async getFramePng(frameIndex) {
    if (!this.latest) return null
    const frame = this.latest.frames[frameIndex]
    if (!frame) return null

    const cacheKey = `${this.latest.generatedAt}:frame:${frameIndex}`
    const hit = framePngCache.get(cacheKey)
    if (hit) return hit

    const data = frame.png || await encodeRgbaPng(frame.rgba, frame.width, frame.height)
    framePngCache.set(cacheKey, data)
    return data
  }

  /** Subscribe to nowcast updates. Returns an unsubscribe function. */
  onUpdate(cb) {
    this._updateListeners.push(cb)
    return () => { this._updateListeners = this._updateListeners.filter(l => l !== cb) }
  }

  async _build({ minutesAhead, stepMinutes, zoom, bbox }) {
    const buildBbox = bbox || config.usBbox
    const history = await fetchRadarHistory({
      tileBase: config.tileBase,
      bbox: buildBbox,
      zoom,
      tileSize: config.tileSize,
      historySteps: config.historySteps,
      stepMinutes,
    })

    // ── Source-freshness guard ────────────────────────────────────────────────
    // If every raw radar tile was served from the in-memory tile cache, IEM
    // hasn't published a new NEXRAD scan yet.  Skip the expensive motion-
    // estimation + forecast rebuild and return the existing cached result.
    // Do NOT skip if the current latest is a disk-restored skeleton (null RGBA)
    // — we must rebuild at least once so tiles can actually be served.
    const latestHasRgba = this.latest?.frames?.some(f => f.rgba != null)
    if (!history.anyFresh && latestHasRgba
        && this.latest.zoom === zoom
        && bboxKey(buildBbox) === bboxKey(this.latest.usBbox)) {
      console.log('[NowcastService] Radar data unchanged — skipping rebuild, serving cached result')
      return this.latest
    }

    const model = await buildNowcastFrames({
      historyFrames: history.frames,
      minutesAhead,
      stepMinutes,
    })

    // Gray arrays were only needed for optical flow — free them before caching.
    for (const f of history.frames) { f.gray = null }
    for (const f of model.frames)   { f.gray = null }

    const frames = []

    for (let i = 0; i < history.frames.length - 1; i++) {
      const h = history.frames[i]
      frames.push({
        index: frames.length,
        minutesAhead: -h.ageMinutes,
        validAt: h.validAt,
        width: h.width,
        height: h.height,
        gray: h.gray,
        rgba: h.rgba,
        png: null,
      })
    }

    const latestObs = history.frames[history.frames.length - 1]
    frames.push({
      index: frames.length,
      minutesAhead: 0,
      validAt: model.latestSourceTime,
      width: latestObs.width,
      height: latestObs.height,
      gray: latestObs.gray,
      rgba: latestObs.rgba,
      png: null,
    })

    for (const f of model.frames) {
      frames.push({
        index: frames.length,
        minutesAhead: f.minutesAhead,
        validAt: f.validAt,
        width: f.width,
        height: f.height,
        gray: f.gray,
        rgba: f.rgba,
        png: null,
      })
    }

    const result = {
      generatedAt: new Date().toISOString(),
      source: 'iem-nexrad-us-composite',
      usBbox: buildBbox,
      imageBounds: boundsForTileRange(history.range, zoom),
      zoom,
      stepMinutes,
      minutesAhead,
      sourceLatestTime: model.latestSourceTime,
      motion: {
        dxPerStep: model.motion.dxPerStep,
        dyPerStep: model.motion.dyPerStep,
      },
      tileRange: history.range,
      frameCount: frames.length,
      frames,
    }

    // Background: encode full-frame PNGs and write the manifest + tile cache.
    ;(async () => {
      for (const frame of frames) {
        try {
          frame.png = await encodeRgbaPng(frame.rgba, frame.width, frame.height)
        } catch (e) {
          console.warn(`Failed to pre-encode frame ${frame.index}:`, e)
        }
      }
    })().catch(e => console.error('Background PNG encoding failed:', e))

    // Write manifest so a future restart can restore metadata without rebuilding.
    writeManifest({
      generatedAt: result.generatedAt,
      zoom: result.zoom,
      stepMinutes: result.stepMinutes,
      minutesAhead: result.minutesAhead,
      usBbox: result.usBbox,
      imageBounds: result.imageBounds,
      tileRange: result.tileRange,
      source: result.source,
      sourceLatestTime: result.sourceLatestTime,
      motion: result.motion,
      frameCount: result.frameCount,
      frames: result.frames.map(f => ({
        index: f.index,
        minutesAhead: f.minutesAhead,
        validAt: f.validAt,
        width: f.width,
        height: f.height,
      })),
    })

    // Prune disk tile directories older than nexradRefreshMs.
    pruneOldEpochDirs(epochOf(result.generatedAt))

    // Pre-warm: eagerly render + cache all tiles so subsequent requests hit
    // memory or disk rather than recomputing from RGBA.
    prewarmTiles(result).catch(e => console.error('Tile prewarm failed:', e))

    return result
  }

  _notifyListeners(generatedAt) {
    for (const cb of this._updateListeners) {
      try { cb(generatedAt) } catch {}
    }
  }
}
