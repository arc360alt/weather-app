import { useEffect, useRef, useState } from 'react'
import * as maptilersdk from '@maptiler/sdk'
import '@maptiler/sdk/dist/maptiler-sdk.css'

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP_SEC         = 10 * 60
const RADAR_REFRESH_MS = 10 * 60 * 1000
const NWS_REFRESH_MS   = 2 * 60 * 1000
const NOWCAST_MIN_ZOOM = 5
const NOWCAST_MAX_ZOOM = 9
const NOWCAST_CACHE_TTL_MS = 4 * 60 * 1000
const NOWCAST_REQUEST_PADDING_RATIO = 0.3
const NOWCAST_BBOX_SNAP_DEG = 0.25
const NOWCAST_RETRY_DELAY_MS = 3000
const NOWCAST_MAX_RETRIES = 40
const NOWCAST_MINUTES_AHEAD = 60
// Use FIXED high-quality zoom for bundled image-frame nowcast
// All frames at same zoom = aligned coordinates; map user-zoom doesn't affect frame zoom
const BUNDLED_NOWCAST_ZOOM = 8
const RAINVIEWER_API   = 'https://api.rainviewer.com/public/weather-maps.json'
const NOWCAST_API_HOST = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname
const CUSTOM_NOWCAST_API = 'https://nowcast.arc360hub.com'
const NWS_ALERTS_API   = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert'
const NEXRAD_SITES_API = 'https://mesonet.agron.iastate.edu/geojson/network.py?network=NEXRAD'
const NEXRAD_OFFSETS   = [60, 50, 40, 30, 20, 10, 0] // minutes ago
const SPEED_MS         = { 1: 900, 3: 500, 6: 500 }
const NWS_ALERT_EVENT_RE = /(warning|watch|advisory|statement)/i
const NWS_WMS_BASE = 'https://mapservices.weather.noaa.gov/eventdriven/services/WWA/watch_warn_adv/MapServer/WMSServer'

const NWS_SOURCE_ID       = 'nws-warning-polygons-source'
const NWS_FILL_LAYER_ID   = 'nws-warning-polygons-fill'
const NWS_STROKE_LAYER_ID = 'nws-warning-polygons-stroke'
const NWS_WMS_SOURCE_ID   = 'nws-warning-raster-fallback-source'
const NWS_WMS_LAYER_ID    = 'nws-warning-raster-fallback-layer'

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function getStyleUrl(style) {
  const key = import.meta.env.VITE_MAPTILER_KEY
  const ids  = { 'streets-v2': 'streets-v2', satellite: 'satellite', 'topo-v2': 'topo-v2', backdrop: 'backdrop', ocean: 'ocean' }
  return `https://api.maptiler.com/maps/${ids[style] ?? 'streets-v2'}/style.json?key=${key}`
}

function buildMaptilerFrames(startSec, endSec) {
  const nowSec = Date.now() / 1000
  const frames = []
  for (let t = startSec; t <= endSec; t += STEP_SEC)
    frames.push({ time: Math.round(t), type: t <= nowSec ? 'past' : 'nowcast' })
  return frames
}

function buildNexradFrames(mode = 'reflectivity') {
  const nexradProduct = mode === 'velocity' ? 'N0U' : 'N0Q'
  const nowMs      = Date.now()
  const intervalMs = 10 * 60 * 1000
  return NEXRAD_OFFSETS.map(minsAgo => {
    const t   = Math.floor((nowMs - minsAgo * 60_000) / intervalMs) * intervalMs
    const d   = new Date(t)
    const pad = n => String(n).padStart(2, '0')
    const key = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`
    const id  = `nexrad-${Math.floor(t / 1000)}`
    return {
      time:    Math.floor(t / 1000),
      type:    'past',
      layerId: id,
      tileUrl: `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-${nexradProduct}-${key}/{z}/{x}/{y}.png`,
    }
  })
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const r = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

async function fetchRainviewerFrames() {
  const res  = await fetch(RAINVIEWER_API)
  const json = await res.json()
  const host = json.host
  const past    = json.radar?.past    ?? []
  const nowcast = json.radar?.nowcast ?? []
  const frames  = [
    ...past.map(f    => ({ time: f.time, path: f.path, type: 'past',    layerId: `rv-${f.time}` })),
    ...nowcast.map(f => ({ time: f.time, path: f.path, type: 'nowcast', layerId: `rv-${f.time}` })),
  ]
  return { host, frames }
}

function rvTileUrl(host, path) {
  return `${host}${path}/512/{z}/{x}/{y}/6/1_1.png`
}

function clampBboxToUs([west, south, east, north]) {
  return [
    Math.max(-125, west),
    Math.max(24, south),
    Math.min(-66, east),
    Math.min(50, north),
  ]
}

function getNowcastViewportBbox(map) {
  if (!map) return null
  const bounds = map.getBounds?.()
  if (!bounds) return null
  const raw = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
  const clamped = clampBboxToUs(raw)
  const [west, south, east, north] = clamped
  if (!(west < east && south < north)) return null
  return clamped
}

function getNowcastRequestZoom(map) {
  const mapZoom = Number(map?.getZoom?.())
  if (!Number.isFinite(mapZoom)) return 6
  // Request one zoom level above view zoom (within bounds) to keep tiles crisp.
  const bump = 1
  return Math.max(NOWCAST_MIN_ZOOM, Math.min(NOWCAST_MAX_ZOOM, Math.round(mapZoom) + bump))
}

function normalizeNowcastBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null
  const snap = v => Math.round((v / NOWCAST_BBOX_SNAP_DEG)) * NOWCAST_BBOX_SNAP_DEG
  return bbox.map(v => Number(snap(v).toFixed(2)))
}

function expandNowcastRequestBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null
  const [west, south, east, north] = bbox
  const width = Math.max(0.5, east - west)
  const height = Math.max(0.5, north - south)
  const padX = width * NOWCAST_REQUEST_PADDING_RATIO
  const padY = height * NOWCAST_REQUEST_PADDING_RATIO
  return normalizeNowcastBbox(clampBboxToUs([
    west - padX,
    south - padY,
    east + padX,
    north + padY,
  ]))
}

function nowcastFrameBbox(frame) {
  const c = frame?.coordinates
  if (!Array.isArray(c) || c.length !== 4) return null
  const west = Number(c[0]?.[0])
  const north = Number(c[0]?.[1])
  const east = Number(c[1]?.[0])
  const south = Number(c[2]?.[1])
  if (![west, south, east, north].every(Number.isFinite)) return null
  if (!(west < east && south < north)) return null
  return [west, south, east, north]
}

function bboxContains(container, inner) {
  if (!container || !inner) return false
  const [cw, cs, ce, cn] = container
  const [iw, is, ie, inorth] = inner
  return cw <= iw && cs <= is && ce >= ie && cn >= inorth
}

function nowcastCacheKey({ minutesAhead, stepMinutes, zoom, bbox } = {}) {
  return JSON.stringify({
    minutesAhead,
    stepMinutes,
    zoom,
    bbox: normalizeNowcastBbox(bbox),
  })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function resolveNowcastAssetUrl(candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) return null
  if (/^https?:\/\//i.test(candidate)) return candidate
  return CUSTOM_NOWCAST_API.replace(/\/$/, '') + candidate
}

async function fetchCustomNowcastFrames({ minutesAhead = NOWCAST_MINUTES_AHEAD, stepMinutes = 10, zoom, bbox, retries = NOWCAST_MAX_RETRIES } = {}) {
  const url = new URL('/v1/nowcast/latest', CUSTOM_NOWCAST_API)
  url.searchParams.set('minutesAhead', String(minutesAhead))
  url.searchParams.set('stepMinutes', String(stepMinutes))
  if (Number.isFinite(zoom)) url.searchParams.set('zoom', String(zoom))
  const normalizedBbox = normalizeNowcastBbox(bbox)
  if (normalizedBbox) url.searchParams.set('bbox', normalizedBbox.join(','))

  let res = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    res = await fetch(url.toString())
    if (res.ok) break
    if (res.status !== 503 || attempt === retries) {
      throw new Error(`Custom nowcast HTTP ${res.status}`)
    }
    await sleep(NOWCAST_RETRY_DELAY_MS)
  }

  if (!res?.ok) throw new Error('Custom nowcast HTTP 503')
  const json = await res.json()

  const frames = (json?.frames ?? []).map((f, idx) => {
    const validAtMs = new Date(f.validAt).getTime()
    const time = Math.floor(validAtMs / 1000)
    const tileUrl = resolveNowcastAssetUrl(f?.tileUrlTemplate || f?.tileUrl)
    const imageUrl = resolveNowcastAssetUrl(f?.imageUrl)
    const minutesAhead = Number(f?.minutesAhead)
    const coordinates = Array.isArray(f?.coordinates) && f.coordinates.length === 4 ? f.coordinates : null
    return {
      time,
      type: Number.isFinite(minutesAhead) && minutesAhead <= 0 ? 'past' : 'nowcast',
      layerId: `custom-nowcast-${f.index ?? idx}-${time}`,
      imageUrl,
      coordinates,
      tileUrlTemplate: tileUrl,
      // Keep both keys for compatibility with legacy raster loading code.
      tileUrl,
      tileSize: 256,
    }
  })

  return frames.filter(f => Number.isFinite(f.time) && (!!f.imageUrl || !!f.tileUrlTemplate))
}

function isPolygonGeometry(geometry) {
  const type = geometry?.type
  return type === 'Polygon' || type === 'MultiPolygon'
}

function alertMatchesOverlay(eventText) {
  return NWS_ALERT_EVENT_RE.test(String(eventText ?? ''))
}

function getUgcCodes(alertFeature) {
  const codes = alertFeature?.properties?.geocode?.UGC
  return Array.isArray(codes) ? codes.filter(c => typeof c === 'string' && c.length >= 3) : []
}

function getZoneTypeFromUgc(ugc) {
  return ugc?.[2] === 'C' ? 'county' : 'forecast'
}

function nwsWarningsTileUrl(cacheBust = Date.now()) {
  return `${NWS_WMS_BASE}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=0&STYLES=default&FORMAT=image/png&TRANSPARENT=TRUE&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}&_t=${cacheBust}`
}

// Waits for a map source to finish loading, with a fallback timeout.
function waitForSource(map, id, ms = 2500) {
  return new Promise(resolve => {
    if (map.isSourceLoaded(id)) { resolve(); return }
    let done = false
    const finish = () => {
      if (done) return; done = true
      map.off('sourcedata', onData); map.off('idle', onIdle)
      clearTimeout(timer); resolve()
    }
    const onData = e => { if (e.sourceId === id && map.isSourceLoaded(id)) finish() }
    const onIdle = ()  => { if (map.isSourceLoaded(id)) finish() }
    const timer  = setTimeout(finish, ms)
    map.on('sourcedata', onData)
    map.on('idle', onIdle)
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Map({ settings = {}, onMapClick, onFramesChange, onPlayingChange, radarControls } = {}) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)
  const markerRef    = useRef(null)

  const [mapReady, setMapReady] = useState(false)

  // ── Layer state (all in refs — never drives re-renders) ───────────────────
  const maptilerLayerRef = useRef(null)      // active @maptiler/weather layer object
  const rasterIdsRef     = useRef(new Set()) // every nexrad-*/rv-* id added to the map
  const activeIdRef      = useRef(null)      // the raster layer currently at full opacity

  // ── Animation state ───────────────────────────────────────────────────────
  const framesRef  = useRef([])
  const indexRef   = useRef(0)
  const pausedRef  = useRef(true)
  const readyRef   = useRef(false)
  const timerRef   = useRef(null)

  // Incremented by dropAllLayers() — any async loadLayer that finds its own
  // session value stale knows it must abort and not touch the map.
  const sessionRef = useRef(0)

  // Refresh timer for auto-reloading radar data
  const refreshTimerRef = useRef(null)

  // NWS warning overlay state
  const nwsWarningsTimerRef = useRef(null)
  const nwsZoneGeomCacheRef = useRef(new globalThis.Map())
  const nwsAbortRef         = useRef(null)

  // NEXRAD site metadata cache (for nearest-station velocity mode)
  const nexradSitesRef = useRef(null)
  const nowcastCacheRef = useRef(new globalThis.Map())
  const nowcastInFlightRef = useRef(new globalThis.Map())
  const nowcastUpdateSeqRef = useRef(0)
  const nowcastCoverageRef = useRef(null)
  // Always points to the latest refreshNowcastForCurrentView (avoids stale-closure in SSE handler)
  const nowcastRefreshRef = useRef(null)

  // ── Settings refs (avoid stale closures in async code) ───────────────────
  const speedRef        = useRef(settings.animationSpeed)
  const opacityRef      = useRef(settings.layerOpacity)
  const warningOpacityRef = useRef(settings.warningLayerOpacity ?? 0.55)
  const animateRadarRef = useRef(settings.animateRadar)
  const settingsRef     = useRef(settings)
  const onFramesRef     = useRef(onFramesChange)
  const onPlayingRef    = useRef(onPlayingChange)

  useEffect(() => { speedRef.current        = settings.animationSpeed }, [settings.animationSpeed])
  useEffect(() => { opacityRef.current      = settings.layerOpacity   }, [settings.layerOpacity])
  useEffect(() => { warningOpacityRef.current = settings.warningLayerOpacity ?? 0.55 }, [settings.warningLayerOpacity])
  useEffect(() => { animateRadarRef.current = settings.animateRadar   }, [settings.animateRadar])
  useEffect(() => { settingsRef.current     = settings                }, [settings])
  useEffect(() => { onFramesRef.current     = onFramesChange          }, [onFramesChange])
  useEffect(() => { onPlayingRef.current    = onPlayingChange         }, [onPlayingChange])

  // ── Imperative refs exposed to RadarControls via radarControls prop ───────
  const playFnRef  = useRef(null)
  const pauseFnRef = useRef(null)
  const seekFnRef  = useRef(null)

  // ── Map init ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return
    maptilersdk.config.apiKey = import.meta.env.VITE_MAPTILER_KEY
    const map = new maptilersdk.Map({
      container:          containerRef.current,
      style:              getStyleUrl(settings.mapStyle),
      center:             [settings.lon, settings.lat],
      zoom:               6,
      attributionControl: true,
    })
    mapRef.current = map
    map.once('idle', () => { wireControls(); setMapReady(true) })
    map.on('click', e => onMapClick?.(e.lngLat.lat, e.lngLat.lng))
    return () => {
      stopLoop()
      stopRefreshTimer()
      stopNwsWarningsTimer()
      map.remove()
      mapRef.current = null
    }
  }, []) // eslint-disable-line

  // ── Fly to location ───────────────────────────────────────────────────────

  useEffect(() => {
    mapRef.current?.flyTo({ center: [settings.lon, settings.lat], speed: 1.5 })
  }, [settings.lat, settings.lon])

  // ── Location pin ──────────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markerRef.current?.remove()
    const el = document.createElement('div')
    el.style.cssText = 'width:28px;height:28px;background:#3b82f6;border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 12px rgba(59,130,246,0.6),0 0 0 4px rgba(59,130,246,0.2);cursor:pointer;'
    const pulse = document.createElement('div')
    pulse.style.cssText = 'position:absolute;top:50%;left:50%;width:44px;height:44px;transform:translate(-50%,-50%) rotate(45deg);border-radius:50%;background:rgba(59,130,246,0.25);animation:pin-pulse 2s ease-out infinite;'
    el.appendChild(pulse)
    if (!document.getElementById('pin-pulse-style')) {
      const s = document.createElement('style'); s.id = 'pin-pulse-style'
      s.textContent = '@keyframes pin-pulse{0%{transform:translate(-50%,-50%) rotate(45deg) scale(0.8);opacity:.8}100%{transform:translate(-50%,-50%) rotate(45deg) scale(2);opacity:0}}'
      document.head.appendChild(s)
    }
    markerRef.current = new maptilersdk.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([settings.lon, settings.lat])
      .addTo(map)
  }, [settings.lat, settings.lon])

  // ── Map style swap ────────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // dropAllLayers first (removes our layers before style wipes everything)
    dropAllLayers()
    map.setStyle(getStyleUrl(settings.mapStyle))
    // After setStyle, MapTiler destroys all sources/layers itself.
    // Our refs are already clear from dropAllLayers, so just wait for idle.
    map.once('idle', () => {
      wireControls()
      loadLayer(settings.weatherLayer, settings.radarProvider)
      if (settingsRef.current.showNwsWarnings) refreshNwsWarnings()
    })
  }, [settings.mapStyle]) // eslint-disable-line

  // ── Weather layer swap ────────────────────────────────────────────────────

  useEffect(() => {
    if (!mapReady) return
    dropAllLayers()
    wireControls()
    loadLayer(settings.weatherLayer, settings.radarProvider)
  }, [settings.weatherLayer]) // eslint-disable-line

  // ── Radar provider swap ───────────────────────────────────────────────────

  useEffect(() => {
    if (!mapReady) return
    if (settingsRef.current.weatherLayer !== 'radar') return
    dropAllLayers()
    wireControls()
    loadLayer('radar', settings.radarProvider)
  }, [settings.radarProvider]) // eslint-disable-line

  // ── Opacity live update ───────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // MapTiler layer opacity
    if (maptilerLayerRef.current && settingsRef.current.weatherLayer !== 'wind') {
      maptilerLayerRef.current.setOpacity?.(settings.layerOpacity)
    }
    // Active raster layer opacity
    if (activeIdRef.current && map.getLayer(activeIdRef.current)) {
      map.setPaintProperty(activeIdRef.current, 'raster-opacity', settings.layerOpacity)
    }
  }, [settings.layerOpacity])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.getLayer(NWS_WMS_LAYER_ID)) {
      map.setPaintProperty(NWS_WMS_LAYER_ID, 'raster-opacity', settings.warningLayerOpacity ?? 0.55)
    }
    if (map.getLayer(NWS_FILL_LAYER_ID)) {
      map.setPaintProperty(NWS_FILL_LAYER_ID, 'fill-opacity', Math.min(1, Math.max(0, (settings.warningLayerOpacity ?? 0.55) * 0.6)))
    }
    if (map.getLayer(NWS_STROKE_LAYER_ID)) {
      map.setPaintProperty(NWS_STROKE_LAYER_ID, 'line-opacity', Math.min(1, Math.max(0, (settings.warningLayerOpacity ?? 0.55) + 0.2)))
    }
  }, [settings.warningLayerOpacity])

  // ── Speed change ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!pausedRef.current) { stopLoop(); scheduleNext() }
  }, [settings.animationSpeed]) // eslint-disable-line

  // ── Initial load once map is ready ───────────────────────────────────────

  useEffect(() => {
    if (!mapReady) return
    loadLayer(settings.weatherLayer, settings.radarProvider)
  }, [mapReady]) // eslint-disable-line

  // ── NWS warning overlay toggle / refresh ────────────────────────────────

  useEffect(() => {
    if (!mapReady) return
    if (settings.showNwsWarnings) {
      refreshNwsWarnings()
      startNwsWarningsTimer()
    } else {
      stopNwsWarningsTimer()
      removeNwsWarningsOverlay()
    }
  }, [mapReady, settings.showNwsWarnings]) // eslint-disable-line

  // Keep warning polygons above weather/radar layers after style reloads
  useEffect(() => {
    if (!mapReady || !settings.showNwsWarnings) return
    bringNwsWarningsToFront()
  }, [mapReady, settings.weatherLayer, settings.radarProvider, settings.mapStyle]) // eslint-disable-line

  // Reload radar if the selected radar mode changes while radar is active
  useEffect(() => {
    if (!mapReady) return
    if (settingsRef.current.weatherLayer !== 'radar') return
    if (settingsRef.current.radarProvider !== 'nexrad') return
    dropAllLayers()
    wireControls()
    loadLayer('radar', settings.radarProvider)
  }, [settings.radarMode]) // eslint-disable-line

  useEffect(() => {
    // Subscribe to server-sent nowcast update events.
    // When the server generates a fresh nowcast, it pushes an 'update' event here,
    // which clears the frontend cache and hot-swaps the forecast frames.
    const es = new EventSource(`${CUSTOM_NOWCAST_API}/v1/nowcast/updates`)
    es.addEventListener('update', () => {
      nowcastCacheRef.current.clear()
      nowcastCoverageRef.current = null
      nowcastRefreshRef.current?.()
    })
    es.onerror = () => {
      // EventSource reconnects automatically — no action needed
      console.warn('[Nowcast] SSE connection error — reconnecting automatically')
    }
    return () => es.close()
  }, []) // eslint-disable-line

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    let timer = null
    const triggerRefresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        nowcastRefreshRef.current?.()
      }, 200)
    }

    map.on('moveend', triggerRefresh)
    map.on('zoomend', triggerRefresh)

    return () => {
      map.off('moveend', triggerRefresh)
      map.off('zoomend', triggerRefresh)
      if (timer) clearTimeout(timer)
    }
  }, [])

  // ─────────────────────────────────────────────────────────────────────────
  // Animation
  // ─────────────────────────────────────────────────────────────────────────

  function stopLoop() {
    clearTimeout(timerRef.current)
    timerRef.current = null
  }

  function scheduleNext() {
    timerRef.current = setTimeout(() => {
      if (pausedRef.current) return
      const next = (indexRef.current + 1) % framesRef.current.length
      goToFrame(next)
      scheduleNext()
    }, SPEED_MS[speedRef.current] ?? 500)
  }

  function play() {
    if (!readyRef.current || !framesRef.current.length) return
    pausedRef.current = false
    onPlayingRef.current?.(true)
    scheduleNext()
  }

  function pause() {
    pausedRef.current = true
    stopLoop()
    onPlayingRef.current?.(false)
  }

  // Single goToFrame that handles both MapTiler and raster providers.
  function goToFrame(idx) {
    if (!readyRef.current || !framesRef.current.length) return
    const clamped = Math.max(0, Math.min(framesRef.current.length - 1, idx))
    indexRef.current = clamped

    if (maptilerLayerRef.current) {
      try { maptilerLayerRef.current.setAnimationTime(framesRef.current[clamped].time) }
      catch (e) { console.warn('setAnimationTime error:', e) }
      onFramesRef.current?.(framesRef.current, clamped)
      return
    }

    // Raster swap: lazily create only active/nearby layers to avoid request storms.
    const map     = mapRef.current
    const frame = framesRef.current[clamped]
    const frameId = frame?.layerId
    if (!map || !frameId) return

    const ensureRasterFrameLayer = (targetFrame) => {
      if (!targetFrame?.layerId) return false
      if (map.getLayer(targetFrame.layerId)) return true

      const tileUrl = targetFrame.tileUrl || targetFrame.tileUrlTemplate
      if (!map.getSource(targetFrame.layerId)) {
        if (tileUrl) {
          // Prefer per-tile raster source — the map requests tiles at whatever zoom
          // level it's currently at (capped at compositeZoom so MapTiler oversamples
          // natively rather than requesting sub-pixel crops).
          const sourceSpec = {
            type: 'raster',
            tiles: [tileUrl],
            tileSize: targetFrame.tileSize ?? 256,
            attribution: '© NOAA/NWS NEXRAD via Iowa State Mesonet',
          }
          if (targetFrame.compositeZoom != null) sourceSpec.maxzoom = targetFrame.compositeZoom
          map.addSource(targetFrame.layerId, sourceSpec)
        } else if (targetFrame.imageUrl) {
          // Fallback: full-frame image source (lower quality when zoomed in)
          map.addSource(targetFrame.layerId, {
            type: 'image',
            url: targetFrame.imageUrl,
            coordinates: targetFrame.coordinates,
          })
        } else {
          return false
        }
      }

      if (!map.getLayer(targetFrame.layerId)) {
        map.addLayer({ id: targetFrame.layerId, type: 'raster', source: targetFrame.layerId, paint: { 'raster-opacity': 0 } })
      }
      rasterIdsRef.current.add(targetFrame.layerId)
      return true
    }

    if (!map.getLayer(frameId)) {
      const created = ensureRasterFrameLayer(frame)
      if (!created) return
      // Layer added at opacity 0 — fall through to the opacity swap so the
      // frame becomes visible immediately; tiles fill in as they load.
    }

    if (frameId !== activeIdRef.current) {
      if (map.getLayer(frameId))
        map.setPaintProperty(frameId, 'raster-opacity', opacityRef.current)
      if (activeIdRef.current && map.getLayer(activeIdRef.current))
        map.setPaintProperty(activeIdRef.current, 'raster-opacity', 0)
      activeIdRef.current = frameId
    }

    const keepIds = new Set([frameId])
    const prevFrame = clamped > 0 ? framesRef.current[clamped - 1] : null
    const nextFrame = clamped < framesRef.current.length - 1 ? framesRef.current[clamped + 1] : null
    if (prevFrame?.layerId) {
      keepIds.add(prevFrame.layerId)
      ensureRasterFrameLayer(prevFrame)
    }
    if (nextFrame?.layerId) {
      keepIds.add(nextFrame.layerId)
      ensureRasterFrameLayer(nextFrame)
    }
    for (const id of [...rasterIdsRef.current]) {
      if (keepIds.has(id)) continue
      try { if (map.getLayer(id)) map.removeLayer(id) } catch {}
      try { if (map.getSource(id)) map.removeSource(id) } catch {}
      rasterIdsRef.current.delete(id)
    }

    onFramesRef.current?.(framesRef.current, clamped)
  }

  // Wire up refs and the radarControls object
  playFnRef.current  = play
  pauseFnRef.current = pause
  seekFnRef.current  = idx => { pause(); goToFrame(idx) }

  function wireControls() {
    if (!radarControls) return
    radarControls.seek       = idx => { pause(); goToFrame(idx) }
    radarControls.togglePlay = ()  => { if (pausedRef.current) play(); else pause() }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Refresh timer
  // ─────────────────────────────────────────────────────────────────────────

  function stopRefreshTimer() {
    if (refreshTimerRef.current) { clearInterval(refreshTimerRef.current); refreshTimerRef.current = null }
  }

  function stopNwsWarningsTimer() {
    if (nwsWarningsTimerRef.current) {
      clearInterval(nwsWarningsTimerRef.current)
      nwsWarningsTimerRef.current = null
    }
    if (nwsAbortRef.current) {
      nwsAbortRef.current.abort()
      nwsAbortRef.current = null
    }
  }

  async function ensureNexradSitesLoaded() {
    if (Array.isArray(nexradSitesRef.current)) return nexradSitesRef.current
    const res = await fetch(NEXRAD_SITES_API)
    if (!res.ok) throw new Error(`NEXRAD site fetch failed: ${res.status}`)
    const json = await res.json()
    const features = Array.isArray(json?.features) ? json.features : []
    const stations = features
      .filter(f => f?.geometry?.type === 'Point' && Array.isArray(f?.geometry?.coordinates))
      .map(f => {
        const [lon, lat] = f.geometry.coordinates
        return {
          id: f?.properties?.sid,
          lat,
          lon,
        }
      })
      .filter(s => typeof s.id === 'string' && Number.isFinite(s.lat) && Number.isFinite(s.lon))

    nexradSitesRef.current = stations
    return stations
  }

  async function getNearestNexradSite(lat, lon) {
    const stations = await ensureNexradSitesLoaded()
    if (!stations.length) return null
    let best = stations[0]
    let bestDist = distanceKm(lat, lon, best.lat, best.lon)
    for (let i = 1; i < stations.length; i += 1) {
      const s = stations[i]
      const d = distanceKm(lat, lon, s.lat, s.lon)
      if (d < bestDist) {
        best = s
        bestDist = d
      }
    }
    return best
  }

  function startRefreshTimer(provider) {
    stopRefreshTimer()
    refreshTimerRef.current = setInterval(() => {
      const wasPlaying = !pausedRef.current
      dropAllLayers()
      loadLayer('radar', provider).then(() => { if (wasPlaying) play() })
    }, RADAR_REFRESH_MS)
  }

  async function fetchNowcastFramesCached({ minutesAhead = NOWCAST_MINUTES_AHEAD, stepMinutes = 10, zoom, bbox, retries = NOWCAST_MAX_RETRIES } = {}) {
    const key = nowcastCacheKey({ minutesAhead, stepMinutes, zoom, bbox })
    const now = Date.now()

    const cached = nowcastCacheRef.current.get(key)
    if (cached && (now - cached.ts) < NOWCAST_CACHE_TTL_MS) return cached.frames

    const existing = nowcastInFlightRef.current.get(key)
    if (existing) return existing

    const promise = fetchCustomNowcastFrames({ minutesAhead, stepMinutes, zoom, bbox, retries })
      .then(frames => {
        nowcastCacheRef.current.set(key, { ts: Date.now(), frames })
        return frames
      })
      .finally(() => {
        nowcastInFlightRef.current.delete(key)
      })

    nowcastInFlightRef.current.set(key, promise)
    return promise
  }

  async function refreshNowcastForCurrentView() {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    if (settingsRef.current.weatherLayer !== 'radar') return
    if (settingsRef.current.radarProvider !== 'nexrad' && settingsRef.current.radarProvider !== 'rainviewer') return
    if (settingsRef.current.radarProvider === 'nexrad' && settingsRef.current.radarMode === 'velocity') return

    // Bundled image-frame mode is not viewport-dependent; refresh via SSE only.
    // This prevents expensive rebuilds on every map zoom/pan.
    if (
      settingsRef.current.radarProvider === 'nexrad' &&
      settingsRef.current.radarMode !== 'velocity' &&
      framesRef.current.some(f => !!f.imageUrl)
    ) {
      return
    }

    const viewBbox = getNowcastViewportBbox(map)
    const expandedBbox = expandNowcastRequestBbox(viewBbox)
    const requestZoom = getNowcastRequestZoom(map)
    if (!expandedBbox) return

    const hasNowcastFrames = framesRef.current.some(f => f.type === 'nowcast')
    const currentCoverage = nowcastCoverageRef.current
    // If we currently only have past frames, keep retrying until nowcast attaches.
    if (hasNowcastFrames && currentCoverage && currentCoverage.zoom === requestZoom && bboxContains(currentCoverage.bbox, viewBbox)) {
      return
    }

    const seq = ++nowcastUpdateSeqRef.current

    let latestNowcast
    try {
      latestNowcast = await fetchNowcastFramesCached({
        minutesAhead: NOWCAST_MINUTES_AHEAD,
        stepMinutes: 10,
        zoom: requestZoom,
        bbox: expandedBbox,
        retries: 8,
      })
    } catch (e) {
      console.warn('[Custom nowcast] refresh failed:', e)
      return
    }
    if (seq !== nowcastUpdateSeqRef.current || !latestNowcast?.length) return

    const oldFrames = framesRef.current
    const oldCurrent = oldFrames[indexRef.current]
    const pastFrames = oldFrames.filter(f => f.type === 'past')

    // If we are currently showing a custom-nowcast-only sequence, replace all frames.
    if (!pastFrames.length) {
      const replacement = [...latestNowcast]
      if (!replacement.length) return

      framesRef.current = replacement
      const oldTime = oldCurrent?.time
      const nextIdx = oldTime == null
        ? replacement.length - 1
        : replacement.reduce((best, f, i) => (Math.abs(f.time - oldTime) < Math.abs(replacement[best].time - oldTime) ? i : best), 0)
      indexRef.current = Math.max(0, Math.min(replacement.length - 1, nextIdx))

      goToFrame(indexRef.current)
      onFramesRef.current?.(replacement, indexRef.current)
      nowcastCoverageRef.current = { zoom: requestZoom, bbox: expandedBbox }
      bringNwsWarningsToFront()
      return
    }

    const maxPastTime = Math.max(...pastFrames.map(f => f.time))
    const appended = latestNowcast.filter(f => f.time > maxPastTime)
    if (!appended.length) return

    const merged = [...pastFrames, ...appended]

    framesRef.current = merged
    const oldTime = oldCurrent?.time
    const nextIdx = oldTime == null
      ? merged.length - 1
      : merged.reduce((best, f, i) => (Math.abs(f.time - oldTime) < Math.abs(merged[best].time - oldTime) ? i : best), 0)
    indexRef.current = Math.max(0, Math.min(merged.length - 1, nextIdx))

    goToFrame(indexRef.current)
    onFramesRef.current?.(merged, indexRef.current)
    nowcastCoverageRef.current = { zoom: requestZoom, bbox: expandedBbox }
    bringNwsWarningsToFront()
  }

  // Always keep this ref current so the SSE handler (which has an empty dep array)
  // always calls the latest version of the function.
  nowcastRefreshRef.current = refreshNowcastForCurrentView

  function startNwsWarningsTimer() {
    stopNwsWarningsTimer()
    nwsWarningsTimerRef.current = setInterval(() => {
      if (settingsRef.current.showNwsWarnings) refreshNwsWarnings()
    }, NWS_REFRESH_MS)
  }

  function ensureNwsWarningsOverlay() {
    const map = mapRef.current
    if (!map) return false

    if (!map.getSource(NWS_SOURCE_ID)) {
      map.addSource(NWS_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
    }

    if (!map.getLayer(NWS_FILL_LAYER_ID)) {
      map.addLayer({
        id: NWS_FILL_LAYER_ID,
        type: 'fill',
        source: NWS_SOURCE_ID,
        paint: {
          'fill-color': '#facc15',
          'fill-opacity': 0.34,
        },
      })
    }

    if (!map.getLayer(NWS_STROKE_LAYER_ID)) {
      map.addLayer({
        id: NWS_STROKE_LAYER_ID,
        type: 'line',
        source: NWS_SOURCE_ID,
        paint: {
          'line-color': '#f8fafc',
          'line-width': 1.4,
          'line-opacity': 0.92,
        },
      })
    }

    bringNwsWarningsToFront()
    return true
  }

  function bringNwsWarningsToFront() {
    const map = mapRef.current
    if (!map) return
    try {
      if (map.getLayer(NWS_WMS_LAYER_ID)) map.moveLayer(NWS_WMS_LAYER_ID)
      if (map.getLayer(NWS_FILL_LAYER_ID)) map.moveLayer(NWS_FILL_LAYER_ID)
      if (map.getLayer(NWS_STROKE_LAYER_ID)) map.moveLayer(NWS_STROKE_LAYER_ID)
    } catch {}
  }

  function ensureNwsFallbackOverlay() {
    const map = mapRef.current
    if (!map) return
    if (!map.getSource(NWS_WMS_SOURCE_ID)) {
      map.addSource(NWS_WMS_SOURCE_ID, {
        type: 'raster',
        tiles: [nwsWarningsTileUrl()],
        tileSize: 256,
        attribution: 'NWS warnings via Iowa State Mesonet',
      })
    }
    if (!map.getLayer(NWS_WMS_LAYER_ID)) {
      map.addLayer({
        id: NWS_WMS_LAYER_ID,
        type: 'raster',
        source: NWS_WMS_SOURCE_ID,
        paint: { 'raster-opacity': warningOpacityRef.current },
      })
    }
  }

  function removeNwsFallbackOverlay() {
    const map = mapRef.current
    if (!map) return
    try { if (map.getLayer(NWS_WMS_LAYER_ID)) map.removeLayer(NWS_WMS_LAYER_ID) } catch {}
    try { if (map.getSource(NWS_WMS_SOURCE_ID)) map.removeSource(NWS_WMS_SOURCE_ID) } catch {}
  }

  function removeNwsWarningsOverlay() {
    const map = mapRef.current
    if (!map) return
    removeNwsFallbackOverlay()
    try { if (map.getLayer(NWS_STROKE_LAYER_ID)) map.removeLayer(NWS_STROKE_LAYER_ID) } catch {}
    try { if (map.getLayer(NWS_FILL_LAYER_ID)) map.removeLayer(NWS_FILL_LAYER_ID) } catch {}
    try { if (map.getSource(NWS_SOURCE_ID)) map.removeSource(NWS_SOURCE_ID) } catch {}
  }

  async function fetchZoneGeometry(ugc, signal) {
    if (!ugc) return null
    if (nwsZoneGeomCacheRef.current.has(ugc)) {
      return nwsZoneGeomCacheRef.current.get(ugc)
    }

    const zoneType = getZoneTypeFromUgc(ugc)
    try {
      const res = await fetch(`https://api.weather.gov/zones/${zoneType}/${ugc}`, {
        headers: { Accept: 'application/geo+json, application/json' },
        signal,
      })
      if (!res.ok) throw new Error(`zone ${ugc} HTTP ${res.status}`)
      const json = await res.json()
      const geometry = isPolygonGeometry(json?.geometry) ? json.geometry : null
      nwsZoneGeomCacheRef.current.set(ugc, geometry)
      return geometry
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.warn('[NWS warnings] zone geometry fetch failed:', ugc, err)
      }
      nwsZoneGeomCacheRef.current.set(ugc, null)
      return null
    }
  }

  async function buildNwsOverlayGeoJson(signal) {
    const res = await fetch(NWS_ALERTS_API, {
      headers: { Accept: 'application/geo+json, application/json' },
      signal,
    })
    if (!res.ok) throw new Error(`NWS alerts HTTP ${res.status}`)

    const json = await res.json()
    const active = Array.isArray(json?.features) ? json.features : []
    const relevant = active.filter(f => alertMatchesOverlay(f?.properties?.event))

    const features = []
    const ugcPairs = []
    const ugcSet = new Set()

    for (const alert of relevant) {
      const props = {
        event: alert?.properties?.event ?? '',
        severity: alert?.properties?.severity ?? '',
        certainty: alert?.properties?.certainty ?? '',
        urgency: alert?.properties?.urgency ?? '',
      }

      if (isPolygonGeometry(alert?.geometry)) {
        features.push({ type: 'Feature', geometry: alert.geometry, properties: props })
        continue
      }

      const ugcs = getUgcCodes(alert)
      for (const ugc of ugcs) {
        ugcPairs.push({ ugc, properties: props })
        ugcSet.add(ugc)
      }
    }

    const ugcList = [...ugcSet]
    const missing = ugcList.filter(ugc => !nwsZoneGeomCacheRef.current.has(ugc))
    const workers = Array.from({ length: 8 }, async () => {
      while (missing.length) {
        if (signal.aborted) return
        const ugc = missing.pop()
        if (!ugc) return
        await fetchZoneGeometry(ugc, signal)
      }
    })
    await Promise.all(workers)

    for (const pair of ugcPairs) {
      const geometry = nwsZoneGeomCacheRef.current.get(pair.ugc)
      if (isPolygonGeometry(geometry)) {
        features.push({
          type: 'Feature',
          geometry,
          properties: pair.properties,
        })
      }
    }

    return { type: 'FeatureCollection', features }
  }

  async function refreshNwsWarnings() {
    const map = mapRef.current
    if (!map || !settingsRef.current.showNwsWarnings) return

    // Use NOAA's official WatchesWarnings WMS as the primary overlay source.
    // This consistently includes watch products (e.g., Tornado Watch).
    removeNwsWarningsOverlay()
    ensureNwsFallbackOverlay()
    bringNwsWarningsToFront()
    return
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Layer teardown — single function that cleans up EVERYTHING
  // ─────────────────────────────────────────────────────────────────────────

  function dropAllLayers() {
    stopLoop()
    stopRefreshTimer()
    sessionRef.current += 1  // invalidate any in-flight loadLayer

    readyRef.current  = false
    pausedRef.current = true
    framesRef.current = []
    onPlayingRef.current?.(false)
    onFramesRef.current?.([], 0)

    const map = mapRef.current
    if (!map) return

    // Remove MapTiler weather layer
    if (maptilerLayerRef.current) {
      const id = maptilerLayerRef.current.id
      try { if (map.getLayer(id)) map.removeLayer(id) } catch {}
      maptilerLayerRef.current = null
    }

    // Remove all raster layers + sources (nexrad-* and rv-*)
    for (const id of rasterIdsRef.current) {
      try { if (map.getLayer(id))  map.removeLayer(id)  } catch {}
      try { if (map.getSource(id)) map.removeSource(id) } catch {}
    }
    rasterIdsRef.current.clear()
    activeIdRef.current = null
    nowcastCoverageRef.current = null
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Layer loading — one function, three code paths
  // ─────────────────────────────────────────────────────────────────────────

  async function loadLayer(type, provider) {
    const mySession = sessionRef.current
    // Returns true if a newer dropAllLayers() or loadLayer() has started
    const stale = () => sessionRef.current !== mySession || !mapRef.current

    // ── Path 1: MapTiler weather layer (wind/precip/temp/pressure/maptiler radar) ──

    if (type !== 'radar' || provider === 'maptiler') {
      let mw
      try { mw = await import('@maptiler/weather') }
      catch { console.error('Run: npm install @maptiler/weather'); return }
      if (stale()) return

      const ClassMap = {
        radar:         mw.RadarLayer,
        wind:          mw.WindLayer,
        precipitation: mw.PrecipitationLayer,
        temperature:   mw.TemperatureLayer,
        pressure:      mw.PressureLayer,
      }
      const LayerClass = ClassMap[type]
      if (!LayerClass) return

      const map   = mapRef.current
      const layer = new LayerClass()
      maptilerLayerRef.current = layer
      map.addLayer(layer)
      bringNwsWarningsToFront()

      await layer.onSourceReadyAsync()
      if (stale()) {
        // A switch happened while we were waiting — clean up this orphaned layer
        try { if (mapRef.current?.getLayer(layer.id)) mapRef.current.removeLayer(layer.id) } catch {}
        maptilerLayerRef.current = null
        return
      }

      if (type !== 'wind') layer.setOpacity?.(opacityRef.current)

      const startSec = layer.getAnimationStart?.()
      const endSec   = layer.getAnimationEnd?.()
      if (startSec == null || endSec == null) return

      const frames = buildMaptilerFrames(startSec, endSec)
      framesRef.current = frames

      const nowSec = Date.now() / 1000
      indexRef.current = frames.reduce((best, f, i) =>
        Math.abs(f.time - nowSec) < Math.abs(frames[best].time - nowSec) ? i : best
      , 0)

      readyRef.current = true
      try { layer.pauseAnimation() } catch {}
      goToFrame(indexRef.current)
      onFramesRef.current?.(frames, indexRef.current)

      if (type === 'radar') startRefreshTimer(provider)
      if (animateRadarRef.current) play()
      return
    }

    // ── Path 2: NEXRAD ────────────────────────────────────────────────────────

    if (provider === 'nexrad') {
      let rawFrames = []
      if (settingsRef.current.radarMode === 'velocity') {
        try {
          const nearest = await getNearestNexradSite(settingsRef.current.lat, settingsRef.current.lon)
          if (nearest?.id) {
            rawFrames = [{
              time: Math.floor(Date.now() / 1000),
              type: 'past',
              layerId: `nexrad-v-${nearest.id}`,
              tileUrl: `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::${nearest.id}-N0U-0/{z}/{x}/{y}.png`,
            }]
          }
        } catch (e) {
          console.error('[NEXRAD velocity] failed to resolve nearest site:', e)
        }
      }

      const map = mapRef.current
       // Load legacy NEXRAD timeline IMMEDIATELY to avoid 30-second hang
       // Then fetch bundled nowcast async and append if it succeeds.
       if (!rawFrames.length) {
        if (!rawFrames.length) {
          // Fallback: Mesonet historical timeline.
          const legacyPastFrames = buildNexradFrames('reflectivity')
          rawFrames = legacyPastFrames
        }
      }

      if (stale()) return
      bringNwsWarningsToFront()

      // Start at the most recent frame closest to "now" so the timeline does not open far in the past.
      const nowSec = Math.floor(Date.now() / 1000)
      const startIdx = rawFrames.reduce((best, f, i) => {
        const bestDt = Math.abs((rawFrames[best]?.time ?? nowSec) - nowSec)
        const thisDt = Math.abs((f?.time ?? nowSec) - nowSec)
        return thisDt < bestDt ? i : best
      }, 0)
      if (stale()) { dropAllLayers(); return }

      framesRef.current = rawFrames
      indexRef.current  = startIdx
      readyRef.current  = true

      goToFrame(indexRef.current)
      onFramesRef.current?.(rawFrames, indexRef.current)
      startRefreshTimer(provider)
      if (animateRadarRef.current) play()

      // If fallback legacy timeline is active (past-only), append bundled custom nowcast.
      ;(async () => {
        if (rawFrames.some(f => f.type === 'nowcast')) return
        try {
          const requestZoom = BUNDLED_NOWCAST_ZOOM
          const serverFrames = await fetchNowcastFramesCached({
            minutesAhead: NOWCAST_MINUTES_AHEAD,
            stepMinutes: 10,
            zoom: requestZoom,
            bbox: null,
            retries: 8,
          })
          if (stale() || !serverFrames?.length) return

          const currentFrames = framesRef.current
          const maxPastTime = Math.max(...currentFrames.filter(f => f.type === 'past').map(f => f.time))
          const appendedNowcast = serverFrames.filter(f => f.time > maxPastTime)
          if (!appendedNowcast.length) return

          const merged = [...currentFrames, ...appendedNowcast]
          framesRef.current = merged
          onFramesRef.current?.(merged, indexRef.current)
          nowcastCoverageRef.current = null
          bringNwsWarningsToFront()
          nowcastRefreshRef.current?.()
        } catch (e) {
          console.warn('[Custom nowcast] initial background load failed:', e)
        }
      })()
      return
    }

    // ── Path 3: RainViewer ────────────────────────────────────────────────────

    if (provider === 'rainviewer') {
      let rvData
      try { rvData = await fetchRainviewerFrames() }
      catch (e) { console.error('[RainViewer] fetch failed:', e); return }
      if (stale()) return

      const { host, frames: rvFrames } = rvData
      if (!rvFrames.length) return

      // Embed the resolved tile URL and size into each frame so
      // ensureRasterFrameLayer can build sources without needing the host closure.
      const rawFrames = rvFrames.map(f => ({
        ...f,
        tileUrl:         rvTileUrl(host, f.path),
        tileUrlTemplate: rvTileUrl(host, f.path),
        tileSize:        512,
      }))

      if (stale()) return

      const map = mapRef.current
      bringNwsWarningsToFront()

      // Start at the most recent past frame and wait for it to load
      const nowSec   = Date.now() / 1000
      const startIdx = rawFrames.reduce((best, f, i) =>
        f.type === 'past' && f.time <= nowSec ? i : best
      , 0)

      if (stale()) { dropAllLayers(); return }

      framesRef.current = rawFrames
      indexRef.current  = startIdx
      readyRef.current  = true

      goToFrame(startIdx)
      onFramesRef.current?.(rawFrames, startIdx)
      startRefreshTimer(provider)
      if (animateRadarRef.current) play()

      // Extend RainViewer with custom nowcast in background.
      ;(async () => {
        try {
          const viewBbox = getNowcastViewportBbox(map)
          const expandedBbox = expandNowcastRequestBbox(viewBbox)
          const requestZoom = getNowcastRequestZoom(map)
          const extraNowcast = await fetchNowcastFramesCached({
            minutesAhead: NOWCAST_MINUTES_AHEAD,
            stepMinutes: 10,
            zoom: requestZoom,
            bbox: expandedBbox,
            retries: 2,
          })
          if (stale() || !extraNowcast.length) return

          const currentFrames = framesRef.current
          const maxTime = Math.max(...currentFrames.map(f => f.time))
          const appended = extraNowcast.filter(f => f.time > maxTime)
          if (!appended.length) return

          const merged = [...currentFrames, ...appended]
          framesRef.current = merged
          onFramesRef.current?.(merged, indexRef.current)
          if (expandedBbox) {
            nowcastCoverageRef.current = { zoom: requestZoom, bbox: expandedBbox }
          }
          bringNwsWarningsToFront()
          nowcastRefreshRef.current?.()
        } catch (e) {
          console.warn('[Custom nowcast] unavailable for RainViewer extension:', e)
        }
      })()
    }
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} />
  )
}