import { useEffect, useRef } from 'react'

const FRAMES = [
  { minutesAgo: 60, label: '-60min' },
  { minutesAgo: 50, label: '-50min' },
  { minutesAgo: 40, label: '-40min' },
  { minutesAgo: 30, label: '-30min' },
  { minutesAgo: 20, label: '-20min' },
  { minutesAgo: 10, label: '-10min' },
  { minutesAgo: 0,  label: 'Now'    },
]

function snapToInterval(ms, intervalMs) {
  return Math.floor(ms / intervalMs) * intervalMs
}

function buildFrames() {
  const nowMs      = Date.now()
  const intervalMs = 10 * 60 * 1000

  return FRAMES.map(f => {
    const t   = snapToInterval(nowMs - f.minutesAgo * 60 * 1000, intervalMs)
    const d   = new Date(t)
    const pad = (n) => String(n).padStart(2, '0')
    const key = `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`
    return {
      time: Math.floor(t / 1000),
      type: 'past',
      tileUrl: `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-${key}/{z}/{x}/{y}.png`,
    }
  })
}

export default function NexradRadar({
  map,
  opacity,
  animationSpeed,
  animateRadar,
  onFramesChange,
  onPlayingChange,
  radarControls,
  onUnmount,
}) {
  const framesRef    = useRef([])
  const indexRef     = useRef(0)
  const pausedRef    = useRef(true)
  const timerRef     = useRef(null)
  const mountedRef   = useRef(true)
  const activeIdRef  = useRef(null)

  const speedRef     = useRef(animationSpeed)
  const opacityRef   = useRef(opacity)
  const onFramesRef  = useRef(onFramesChange)
  const onPlayingRef = useRef(onPlayingChange)

  useEffect(() => { speedRef.current     = animationSpeed  }, [animationSpeed])
  useEffect(() => { opacityRef.current   = opacity         }, [opacity])
  useEffect(() => { onFramesRef.current  = onFramesChange  }, [onFramesChange])
  useEffect(() => { onPlayingRef.current = onPlayingChange }, [onPlayingChange])

  // Wire controls once on mount. onUnmount restores them to MapTiler when destroyed.
  useEffect(() => {
    if (radarControls) {
      radarControls.seek       = (idx) => { pause(); goToFrame(idx) }
      radarControls.togglePlay = () => { if (pausedRef.current) play(); else pause() }
    }
    return () => {
      onUnmount?.()
    }
  }, []) // eslint-disable-line

  useEffect(() => {
    mountedRef.current = true
    if (!map) return

    function init() {
      const frames = buildFrames()
      framesRef.current = frames
      if (!mountedRef.current) return

      const lastIdx = frames.length - 1
      indexRef.current = lastIdx
      goToFrame(lastIdx)
      onFramesRef.current?.(frames, lastIdx)
      if (animateRadar) play()
    }

    if (map.isStyleLoaded()) {
      init()
    } else {
      map.once('idle', init)
    }

    return () => {
      mountedRef.current = false
      pause()
      removeCurrent()
      onFramesRef.current?.([], 0)
    }
  }, [map]) // eslint-disable-line

  useEffect(() => {
    if (!map || activeIdRef.current === null) return
    if (map.getLayer(activeIdRef.current)) {
      map.setPaintProperty(activeIdRef.current, 'raster-opacity', opacity)
    }
  }, [opacity, map])

  function removeCurrent() {
    if (!map || activeIdRef.current === null) return
    const id = activeIdRef.current
    try { if (map.getLayer(id))  map.removeLayer(id) }  catch {}
    try { if (map.getSource(id)) map.removeSource(id) } catch {}
    activeIdRef.current = null
  }

  async function goToFrame(idx) {
    const frames = framesRef.current
    if (!frames.length || !map) return
    const clamped = Math.max(0, Math.min(frames.length - 1, idx))
    const frame   = frames[clamped]
    const id      = `nexrad-${frame.time}`

    if (activeIdRef.current === id) {
      indexRef.current = clamped
      onFramesRef.current?.(frames, clamped)
      return
    }

    if (!map.getSource(id)) {
      map.addSource(id, {
        type:        'raster',
        tiles:       [frame.tileUrl],
        tileSize:    256,
        attribution: '© NOAA/NWS NEXRAD via Iowa State Mesonet',
      })
    }
    if (!map.getLayer(id)) {
      map.addLayer({
        id,
        type:   'raster',
        source: id,
        paint:  { 'raster-opacity': 0 },
      })
    }

    await new Promise(resolve => {
      if (map.isSourceLoaded(id)) { resolve(); return }
      const onData = (e) => {
        if (e.sourceId === id && map.isSourceLoaded(id)) {
          map.off('sourcedata', onData)
          resolve()
        }
      }
      map.on('sourcedata', onData)
      setTimeout(resolve, 2000)
    })

    if (!mountedRef.current) return

    if (map.getLayer(id)) {
      map.setPaintProperty(id, 'raster-opacity', opacityRef.current)
    }
    removeCurrent()
    activeIdRef.current = id
    indexRef.current    = clamped
    onFramesRef.current?.(frames, clamped)
  }

  function stopLoop() {
    clearTimeout(timerRef.current)
    timerRef.current = null
  }

  function scheduleNext() {
    const ms = ({ 1: 900, 3: 500, 6: 200 })[speedRef.current] ?? 500
    timerRef.current = setTimeout(async () => {
      if (pausedRef.current) return
      const next = (indexRef.current + 1) % framesRef.current.length
      await goToFrame(next)
      scheduleNext()
    }, ms)
  }

  function play() {
    if (!framesRef.current.length) return
    pausedRef.current = false
    onPlayingRef.current?.(true)
    scheduleNext()
  }

  function pause() {
    pausedRef.current = true
    stopLoop()
    onPlayingRef.current?.(false)
  }

  return null
}