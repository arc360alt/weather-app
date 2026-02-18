import { useEffect, useRef } from 'react'
import * as maptilersdk from '@maptiler/sdk'
import '@maptiler/sdk/dist/maptiler-sdk.css'

const STEP_SEC = 10 * 60  // 10 min steps

function getStyleUrl(style) {
  const key = import.meta.env.VITE_MAPTILER_KEY
  const ids = {
    'streets-v2': 'streets-v2',
    'satellite':  'satellite',
    'topo-v2':    'topo-v2',
    'backdrop':   'backdrop',
    'ocean':      'ocean',
  }
  const id = ids[style] ?? 'streets-v2'
  return `https://api.maptiler.com/maps/${id}/style.json?key=${key}`
}

function buildFrames(startSec, endSec) {
  const nowSec = Date.now() / 1000
  const frames = []
  for (let t = startSec; t <= endSec; t += STEP_SEC) {
    frames.push({
      time: Math.round(t),
      type: t <= nowSec ? 'past' : 'nowcast',
    })
  }
  return frames
}

export default function Map({ settings, onMapClick, onFramesChange, onPlayingChange, radarControls }) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)
  const markerRef    = useRef(null)
  const layerRef     = useRef(null)

  const framesRef    = useRef([])
  const indexRef     = useRef(0)
  const pausedRef    = useRef(true)
  const timerRef     = useRef(null)
  const readyRef     = useRef(false)
  const loadingRef   = useRef(false)

  const speedRef        = useRef(settings.animationSpeed)
  const opacityRef      = useRef(settings.layerOpacity)
  const animateRadarRef = useRef(settings.animateRadar)
  const onFramesRef     = useRef(onFramesChange)
  const onPlayingRef    = useRef(onPlayingChange)

  useEffect(() => { speedRef.current        = settings.animationSpeed }, [settings.animationSpeed])
  useEffect(() => { opacityRef.current      = settings.layerOpacity   }, [settings.layerOpacity])
  useEffect(() => { animateRadarRef.current = settings.animateRadar   }, [settings.animateRadar])
  useEffect(() => { onFramesRef.current     = onFramesChange          }, [onFramesChange])
  useEffect(() => { onPlayingRef.current    = onPlayingChange         }, [onPlayingChange])

  // Wire controls once on mount
  useEffect(() => {
    if (!radarControls) return
    radarControls.seek = (idx) => { pause(); goToFrame(idx) }
    radarControls.togglePlay = () => { if (pausedRef.current) play(); else pause() }
  }, []) // eslint-disable-line

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
    mapRef.current.once('idle', () => loadLayer(settings.weatherLayer))
    mapRef.current.on('click', (e) => onMapClick?.(e.lngLat.lat, e.lngLat.lng))
    return () => { stopLoop(); mapRef.current?.remove() }
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
  loadingRef.current = false  // add this
  stopLoop(); dropLayer()
  mapRef.current.setStyle(getStyleUrl(settings.mapStyle))
  mapRef.current.once('idle', () => loadLayer(settings.weatherLayer))
}, [settings.mapStyle]) // eslint-disable-line

// Weather layer swap
useEffect(() => {
  if (!mapRef.current?.isStyleLoaded()) return
  loadingRef.current = false 
  stopLoop(); dropLayer()
  loadLayer(settings.weatherLayer)
}, [settings.weatherLayer]) // eslint-disable-line

  // Opacity
  useEffect(() => {
    layerRef.current?.setOpacity?.(settings.layerOpacity)
  }, [settings.layerOpacity])

  // Speed change
  useEffect(() => {
    if (!pausedRef.current) { stopLoop(); scheduleNext() }
  }, [settings.animationSpeed]) // eslint-disable-line

  // ── Animation ─────────────────────────────────────────────────────────────────

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
    try {
      layerRef.current.setAnimationTime(framesRef.current[clamped].time)
    } catch (e) {
      console.warn('setAnimationTime error:', e)
    }
    onFramesRef.current?.(framesRef.current, clamped)
  }

  // ── Layer ─────────────────────────────────────────────────────────────────────

function dropLayer() {
  loadingRef.current = false
  readyRef.current = false
  stopLoop()
  if (!layerRef.current || !mapRef.current) return
  const id = layerRef.current.id ?? layerRef.current
  try {
    if (mapRef.current.getLayer(id)) mapRef.current.removeLayer(id)
  } catch (e) {
    console.warn('removeLayer error:', e)
  }
  layerRef.current = null
  onFramesRef.current?.([], 0)
}

  async function loadLayer(type) {
    if (loadingRef.current) return
    loadingRef.current = true

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

    // Drop previous layer without resetting loadingRef
    readyRef.current = false
    stopLoop()
    if (layerRef.current && mapRef.current) {
      try { mapRef.current.removeLayer(layerRef.current) } catch {
        try { mapRef.current.removeLayer(layerRef.current.id) } catch {}
      }
      layerRef.current = null
    }

    try {
      const layer = new LayerClass()
      layerRef.current = layer
      mapRef.current.addLayer(layer)
      layer.setOpacity?.(opacityRef.current)

      if (type === 'radar') {
        await layer.onSourceReadyAsync()

        // Guard: bail if layer was replaced while we were awaiting
        if (layerRef.current !== layer) return

        const startSec = layer.getAnimationStart()
        const endSec   = layer.getAnimationEnd()
        const nowSec   = Date.now() / 1000

        console.log('[Radar] range:', new Date(startSec * 1000).toLocaleTimeString(), '-', new Date(endSec * 1000).toLocaleTimeString())

        const frames = buildFrames(startSec, endSec)
        framesRef.current = frames

        indexRef.current = frames.reduce((best, f, i) =>
          Math.abs(f.time - nowSec) < Math.abs(frames[best].time - nowSec) ? i : best
        , 0)

        readyRef.current = true

        try { layer.pauseAnimation() } catch {}

        goToFrame(indexRef.current)
        onFramesRef.current?.(frames, indexRef.current)

        if (animateRadarRef.current) play()
      } else {
        readyRef.current = false
        onFramesRef.current?.([], 0)
      }
    } catch (e) {
      console.warn('loadLayer error:', e)
    } finally {
      loadingRef.current = false
    }
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} />
  )
}