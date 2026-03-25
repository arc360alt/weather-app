import { useEffect, useRef, useState } from 'react'
import * as maptilersdk from '@maptiler/sdk'
import '@maptiler/sdk/dist/maptiler-sdk.css'
import RainViewerRadar from './RainViewerRadar'
import NexradRadar from './NexradRadar'

const STEP_SEC         = 10 * 60
const RADAR_REFRESH_MS = 10 * 60 * 1000

function getStyleUrl(style) {
  const key = import.meta.env.VITE_MAPTILER_KEY
  const ids = {
    'streets-v2': 'streets-v2',
    'satellite':  'satellite',
    'topo-v2':    'topo-v2',
    'backdrop':   'backdrop',
    'ocean':      'ocean',
  }
  return `https://api.maptiler.com/maps/${ids[style] ?? 'streets-v2'}/style.json?key=${key}`
}

function buildFrames(startSec, endSec) {
  const nowSec = Date.now() / 1000
  const frames = []
  for (let t = startSec; t <= endSec; t += STEP_SEC) {
    frames.push({ time: Math.round(t), type: t <= nowSec ? 'past' : 'nowcast' })
  }
  return frames
}

const PARTICLE_LAYERS = new Set(['wind'])

export default function Map({ settings, onMapClick, onFramesChange, onPlayingChange, radarControls }) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)
  const markerRef    = useRef(null)
  const layerRef     = useRef(null)
  const layerTypeRef = useRef(null)

  const framesRef  = useRef([])
  const indexRef   = useRef(0)
  const pausedRef  = useRef(true)
  const timerRef   = useRef(null)
  const readyRef   = useRef(false)
  const loadingRef = useRef(false)

  const refreshTimerRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  const [radarKey, setRadarKey] = useState(0)

  const speedRef        = useRef(settings.animationSpeed)
  const opacityRef      = useRef(settings.layerOpacity)
  const animateRadarRef = useRef(settings.animateRadar)
  const onFramesRef     = useRef(onFramesChange)
  const onPlayingRef    = useRef(onPlayingChange)
  const settingsRef     = useRef(settings)

  useEffect(() => { speedRef.current        = settings.animationSpeed }, [settings.animationSpeed])
  useEffect(() => { opacityRef.current      = settings.layerOpacity   }, [settings.layerOpacity])
  useEffect(() => { animateRadarRef.current = settings.animateRadar   }, [settings.animateRadar])
  useEffect(() => { onFramesRef.current     = onFramesChange          }, [onFramesChange])
  useEffect(() => { onPlayingRef.current    = onPlayingChange         }, [onPlayingChange])
  useEffect(() => { settingsRef.current     = settings                }, [settings])

  const goToFrameRef = useRef(null)
  const playRef      = useRef(null)
  const pauseRef     = useRef(null)

  function rewireToMapTiler() {
    if (!radarControls) return
    radarControls.seek       = (idx) => { pauseRef.current?.(); goToFrameRef.current?.(idx) }
    radarControls.togglePlay = () => { if (pausedRef.current) playRef.current?.(); else pauseRef.current?.() }
  }

  // Init map once
  useEffect(() => {
    if (!containerRef.current) return
    maptilersdk.config.apiKey = import.meta.env.VITE_MAPTILER_KEY
    mapRef.current = new maptilersdk.Map({
      container:          containerRef.current,
      style:              getStyleUrl(settings.mapStyle),
      center:             [settings.lon, settings.lat],
      zoom:               6,
      attributionControl: true,
    })
    mapRef.current.once('idle', () => {
      rewireToMapTiler()
      loadLayer(settings.weatherLayer)
      setMapReady(true)
    })
    mapRef.current.on('click', (e) => onMapClick?.(e.lngLat.lat, e.lngLat.lng))
    return () => {
      stopLoop()
      stopRefreshTimer()
      mapRef.current?.remove()
    }
  }, []) // eslint-disable-line

  // Fly to location
  useEffect(() => {
    mapRef.current?.flyTo({ center: [settings.lon, settings.lat], speed: 1.5 })
  }, [settings.lat, settings.lon])

  // Location pin
  useEffect(() => {
    if (!mapRef.current) return
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
      .setLngLat([settings.lon, settings.lat]).addTo(mapRef.current)
  }, [settings.lat, settings.lon])

  // Map style swap
  useEffect(() => {
    if (!mapRef.current) return
    loadingRef.current = false
    stopLoop(); stopRefreshTimer(); dropLayer()
    mapRef.current.setStyle(getStyleUrl(settings.mapStyle))
    mapRef.current.once('idle', () => {
      rewireToMapTiler()
      loadLayer(settings.weatherLayer)
      setRadarKey(k => k + 1)
    })
  }, [settings.mapStyle]) // eslint-disable-line

  // Weather layer swap
  useEffect(() => {
    if (!mapRef.current?.isStyleLoaded()) return
    loadingRef.current = false
    stopLoop(); stopRefreshTimer(); dropLayer()
    rewireToMapTiler()
    loadLayer(settings.weatherLayer)
  }, [settings.weatherLayer]) // eslint-disable-line

  // Radar provider swap.
  // Key insight: always drop the MapTiler layer first (synchronously), THEN
  // bump radarKey so the incoming child mounts onto a clean map.
  // If switching TO maptiler, rewire controls and load the layer directly.
  useEffect(() => {
    if (!mapRef.current?.isStyleLoaded()) return

    if (settingsRef.current.weatherLayer === 'radar') {
      // Always tear down whatever is currently on the map first
      loadingRef.current = false
      stopLoop(); stopRefreshTimer(); dropLayer()

      if (settings.radarProvider === 'maptiler') {
        // MapTiler handles itself — rewire controls and load
        rewireToMapTiler()
        loadLayer('radar')
      } else {
        // External provider — bump key AFTER dropLayer so the child
        // mounts onto a map with no leftover MapTiler layer
        setRadarKey(k => k + 1)
      }
    } else {
      // Not on radar right now — just pre-bump the key so when the user
      // switches to radar later the child starts fresh
      setRadarKey(k => k + 1)
    }
  }, [settings.radarProvider]) // eslint-disable-line

  // Opacity
  useEffect(() => {
    if (!layerRef.current || !readyRef.current) return
    if (PARTICLE_LAYERS.has(layerTypeRef.current)) return
    layerRef.current.setOpacity?.(settings.layerOpacity)
  }, [settings.layerOpacity])

  // Speed change
  useEffect(() => {
    if (!pausedRef.current) { stopLoop(); scheduleNext() }
  }, [settings.animationSpeed]) // eslint-disable-line

  // ── Refresh timer ────────────────────────────────────────────────────────────

  function stopRefreshTimer() {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
  }

  function startRefreshTimer() {
    stopRefreshTimer()
    refreshTimerRef.current = setInterval(() => {
      const wasPlaying = !pausedRef.current
      loadingRef.current = false
      stopLoop()
      dropLayer()
      loadLayer('radar').then(() => { if (wasPlaying) play() })
    }, RADAR_REFRESH_MS)
  }

  // ── Animation ────────────────────────────────────────────────────────────────

  function stopLoop() {
    clearTimeout(timerRef.current)
    timerRef.current = null
  }

  function scheduleNext() {
    const ms = ({ 1: 900, 3: 500, 6: 200 })[speedRef.current] ?? 500
    timerRef.current = setTimeout(() => {
      if (pausedRef.current) return
      const next = (indexRef.current + 1) % framesRef.current.length
      goToFrame(next)
      scheduleNext()
    }, ms)
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

  function goToFrame(idx) {
    if (!readyRef.current || !framesRef.current.length || !layerRef.current) return
    const clamped = Math.max(0, Math.min(framesRef.current.length - 1, idx))
    indexRef.current = clamped
    try { layerRef.current.setAnimationTime(framesRef.current[clamped].time) }
    catch (e) { console.warn('setAnimationTime error:', e) }
    onFramesRef.current?.(framesRef.current, clamped)
  }

  goToFrameRef.current = goToFrame
  playRef.current      = play
  pauseRef.current     = pause

  // ── Layer management ─────────────────────────────────────────────────────────

  function dropLayer() {
    readyRef.current = false
    stopLoop()
    if (layerRef.current && mapRef.current) {
      const id = layerRef.current.id ?? layerRef.current
      try { if (mapRef.current.getLayer(id)) mapRef.current.removeLayer(id) }
      catch (e) { console.warn('removeLayer error:', e) }
    }
    layerRef.current     = null
    layerTypeRef.current = null
    framesRef.current    = []
    onFramesRef.current?.([], 0)
  }

  async function loadLayer(type) {
    if (loadingRef.current) return
    loadingRef.current = true
    layerTypeRef.current = type

    const provider = settingsRef.current.radarProvider ?? 'maptiler'
    if (type === 'radar' && provider !== 'maptiler') {
      loadingRef.current = false
      return
    }

    let mw
    try { mw = await import('@maptiler/weather') }
    catch { console.error('Run: npm install @maptiler/weather'); loadingRef.current = false; return }
    if (!mapRef.current) { loadingRef.current = false; return }

    const ClassMap = {
      radar:         mw.RadarLayer,
      wind:          mw.WindLayer,
      precipitation: mw.PrecipitationLayer,
      temperature:   mw.TemperatureLayer,
      pressure:      mw.PressureLayer,
    }
    const LayerClass = ClassMap[type]
    if (!LayerClass) { loadingRef.current = false; return }

    if (layerRef.current && mapRef.current) {
      const id = layerRef.current.id ?? layerRef.current
      try { if (mapRef.current.getLayer(id)) mapRef.current.removeLayer(id) }
      catch {}
      layerRef.current = null
    }
    readyRef.current = false
    stopLoop()

    try {
      const layer = new LayerClass()
      layerRef.current = layer
      mapRef.current.addLayer(layer)

      await layer.onSourceReadyAsync()

      if (layerRef.current !== layer) {
        loadingRef.current = false
        return
      }

      layer.setOpacity?.(opacityRef.current)

      const startSec = layer.getAnimationStart?.()
      const endSec   = layer.getAnimationEnd?.()

      if (startSec == null || endSec == null) {
        readyRef.current = false
        onFramesRef.current?.([], 0)
        loadingRef.current = false
        return
      }

      const frames = buildFrames(startSec, endSec)
      framesRef.current = frames

      const nowSec = Date.now() / 1000
      indexRef.current = frames.reduce((best, f, i) =>
        Math.abs(f.time - nowSec) < Math.abs(frames[best].time - nowSec) ? i : best
      , 0)

      readyRef.current = true
      try { layer.pauseAnimation() } catch {}

      goToFrame(indexRef.current)
      onFramesRef.current?.(frames, indexRef.current)

      if (type === 'radar') startRefreshTimer()
      if (animateRadarRef.current) play()

    } catch (e) {
      console.warn('loadLayer error:', e)
      stopRefreshTimer()
    } finally {
      loadingRef.current = false
    }
  }

  return (
    <>
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} />
      {mapReady && settings.weatherLayer === 'radar' && settings.radarProvider === 'rainviewer' && (
        <RainViewerRadar
          key={radarKey}
          map={mapRef.current}
          opacity={settings.layerOpacity}
          animationSpeed={settings.animationSpeed}
          animateRadar={settings.animateRadar}
          onFramesChange={onFramesChange}
          onPlayingChange={onPlayingChange}
          radarControls={radarControls}
          onUnmount={rewireToMapTiler}
        />
      )}
      {mapReady && settings.weatherLayer === 'radar' && settings.radarProvider === 'nexrad' && (
        <NexradRadar
          key={radarKey}
          map={mapRef.current}
          opacity={settings.layerOpacity}
          animationSpeed={settings.animationSpeed}
          animateRadar={settings.animateRadar}
          onFramesChange={onFramesChange}
          onPlayingChange={onPlayingChange}
          radarControls={radarControls}
          onUnmount={rewireToMapTiler}
        />
      )}
    </>
  )
}