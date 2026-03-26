import { useEffect, useRef, useState } from 'react'
import * as maptilersdk from '@maptiler/sdk'
import '@maptiler/sdk/dist/maptiler-sdk.css'

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP_SEC         = 10 * 60
const RADAR_REFRESH_MS = 10 * 60 * 1000
const RAINVIEWER_API   = 'https://api.rainviewer.com/public/weather-maps.json'
const NEXRAD_OFFSETS   = [60, 50, 40, 30, 20, 10, 0] // minutes ago
const SPEED_MS         = { 1: 900, 3: 500, 6: 200 }

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

function buildNexradFrames() {
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
      tileUrl: `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-${key}/{z}/{x}/{y}.png`,
    }
  })
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

export default function Map({ settings, onMapClick, onFramesChange, onPlayingChange, radarControls }) {
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

  // ── Settings refs (avoid stale closures in async code) ───────────────────
  const speedRef        = useRef(settings.animationSpeed)
  const opacityRef      = useRef(settings.layerOpacity)
  const animateRadarRef = useRef(settings.animateRadar)
  const settingsRef     = useRef(settings)
  const onFramesRef     = useRef(onFramesChange)
  const onPlayingRef    = useRef(onPlayingChange)

  useEffect(() => { speedRef.current        = settings.animationSpeed }, [settings.animationSpeed])
  useEffect(() => { opacityRef.current      = settings.layerOpacity   }, [settings.layerOpacity])
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

  // ── Speed change ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!pausedRef.current) { stopLoop(); scheduleNext() }
  }, [settings.animationSpeed]) // eslint-disable-line

  // ── Initial load once map is ready ───────────────────────────────────────

  useEffect(() => {
    if (!mapReady) return
    loadLayer(settings.weatherLayer, settings.radarProvider)
  }, [mapReady]) // eslint-disable-line

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
  // For raster layers we swap opacity synchronously — the tile is already
  // in the map (added at load time), so there's no async wait needed here.
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

    // Raster swap: show new, hide old
    const map     = mapRef.current
    const frameId = framesRef.current[clamped]?.layerId
    if (!map || !frameId) return

    if (frameId !== activeIdRef.current) {
      if (map.getLayer(frameId))
        map.setPaintProperty(frameId, 'raster-opacity', opacityRef.current)
      if (activeIdRef.current && map.getLayer(activeIdRef.current))
        map.setPaintProperty(activeIdRef.current, 'raster-opacity', 0)
      activeIdRef.current = frameId
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

  function startRefreshTimer(provider) {
    stopRefreshTimer()
    refreshTimerRef.current = setInterval(() => {
      const wasPlaying = !pausedRef.current
      dropAllLayers()
      loadLayer('radar', provider).then(() => { if (wasPlaying) play() })
    }, RADAR_REFRESH_MS)
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
      const rawFrames = buildNexradFrames()
      if (stale()) return

      const map = mapRef.current

      // Add all frames as hidden raster layers up front.
      // Doing this before waiting means all tiles start fetching in parallel.
      for (const f of rawFrames) {
        if (!map.getSource(f.layerId)) {
          map.addSource(f.layerId, {
            type:        'raster',
            tiles:       [f.tileUrl],
            tileSize:    256,
            attribution: '© NOAA/NWS NEXRAD via Iowa State Mesonet',
          })
        }
        if (!map.getLayer(f.layerId)) {
          map.addLayer({ id: f.layerId, type: 'raster', source: f.layerId, paint: { 'raster-opacity': 0 } })
        }
        rasterIdsRef.current.add(f.layerId)
      }

      // Wait only for the most recent frame before making the layer "ready"
      const lastFrame = rawFrames[rawFrames.length - 1]
      await waitForSource(map, lastFrame.layerId)
      if (stale()) { dropAllLayers(); return }

      framesRef.current = rawFrames
      indexRef.current  = rawFrames.length - 1
      readyRef.current  = true

      goToFrame(indexRef.current)
      onFramesRef.current?.(rawFrames, indexRef.current)
      startRefreshTimer(provider)
      if (animateRadarRef.current) play()
      return
    }

    // ── Path 3: RainViewer ────────────────────────────────────────────────────

    if (provider === 'rainviewer') {
      let rvData
      try { rvData = await fetchRainviewerFrames() }
      catch (e) { console.error('[RainViewer] fetch failed:', e); return }
      if (stale()) return

      const { host, frames: rawFrames } = rvData
      if (!rawFrames.length) return

      const map = mapRef.current

      // Add all frames as hidden raster layers up front (parallel tile fetching)
      for (const f of rawFrames) {
        if (!map.getSource(f.layerId)) {
          map.addSource(f.layerId, { type: 'raster', tiles: [rvTileUrl(host, f.path)], tileSize: 512 })
        }
        if (!map.getLayer(f.layerId)) {
          map.addLayer({ id: f.layerId, type: 'raster', source: f.layerId, paint: { 'raster-opacity': 0 } })
        }
        rasterIdsRef.current.add(f.layerId)
      }

      // Start at the most recent past frame and wait for it to load
      const nowSec   = Date.now() / 1000
      const startIdx = rawFrames.reduce((best, f, i) =>
        f.type === 'past' && f.time <= nowSec ? i : best
      , 0)

      await waitForSource(map, rawFrames[startIdx].layerId)
      if (stale()) { dropAllLayers(); return }

      framesRef.current = rawFrames
      indexRef.current  = startIdx
      readyRef.current  = true

      goToFrame(startIdx)
      onFramesRef.current?.(rawFrames, startIdx)
      startRefreshTimer(provider)
      if (animateRadarRef.current) play()
    }
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} />
  )
}