import { useEffect, useRef } from 'react'

const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json'

export default function RainViewerRadar({
  map,
  opacity,
  animationSpeed,
  animateRadar,
  onFramesChange,
  onPlayingChange,
  radarControls,
}) {
  const framesRef    = useRef([])
  const indexRef     = useRef(0)
  const pausedRef    = useRef(true)
  const timerRef     = useRef(null)
  const mountedRef   = useRef(true)
  const hostRef      = useRef('')
  const activeIdRef  = useRef(null)  // currently visible layer id

  const speedRef      = useRef(animationSpeed)
  const opacityRef    = useRef(opacity)
  const onFramesRef   = useRef(onFramesChange)
  const onPlayingRef  = useRef(onPlayingChange)

  useEffect(() => { speedRef.current    = animationSpeed }, [animationSpeed])
  useEffect(() => { opacityRef.current  = opacity },        [opacity])
  useEffect(() => { onFramesRef.current = onFramesChange }, [onFramesChange])
  useEffect(() => { onPlayingRef.current = onPlayingChange },[onPlayingChange])

  useEffect(() => {
    if (!radarControls) return
    radarControls.seek = (idx) => { pause(); goToFrame(idx) }
    radarControls.togglePlay = () => { if (pausedRef.current) play(); else pause() }
  }, []) // eslint-disable-line

  useEffect(() => {
    mountedRef.current = true
    if (!map) return

    if (radarControls) {
      radarControls.seek       = (idx) => { pause(); goToFrame(idx) }
      radarControls.togglePlay = () => { if (pausedRef.current) play(); else pause() }
    }

    async function init() {
      let json
      try {
        const res = await fetch(RAINVIEWER_API)
        json = await res.json()
      } catch (e) {
        console.error('[RainViewer] Failed to fetch API:', e)
        return
      }
      if (!mountedRef.current) return

      hostRef.current = json.host
      const past    = json.radar?.past    ?? []
      const nowcast = json.radar?.nowcast ?? []
      const allFrames = [
        ...past.map(f    => ({ time: f.time, path: f.path, type: 'past' })),
        ...nowcast.map(f => ({ time: f.time, path: f.path, type: 'nowcast' })),
      ]

      framesRef.current = allFrames
      if (!allFrames.length) return

      // Start at most recent past frame
      const nowSec = Date.now() / 1000
      const startIdx = allFrames.reduce((best, f, i) =>
        f.type === 'past' && f.time <= nowSec ? i : best
      , 0)
      indexRef.current = startIdx

      // Pre-add the source and layer so tile fetching starts immediately,
      // then wait for it to load before calling goToFrame so it shows instantly.
      const frame = allFrames[startIdx]
      const id    = `rv-${frame.time}`

      if (!map.getSource(id)) {
        map.addSource(id, {
          type:     'raster',
          tiles:    [tileUrl(frame.path)],
          tileSize: 512,
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

      // Wait for the initial frame to be tile-ready before revealing it
      await waitForSource(id)
      if (!mountedRef.current) return

      await goToFrame(startIdx)
      onFramesRef.current?.(allFrames, startIdx)
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

  // Opacity live update
  useEffect(() => {
    if (!map || activeIdRef.current === null) return
    const id = activeIdRef.current
    if (map.getLayer(id)) {
      map.setPaintProperty(id, 'raster-opacity', opacity)
    }
  }, [opacity, map])

  function tileUrl(path) {
    return `${hostRef.current}${path}/512/{z}/{x}/{y}/6/1_1.png`
  }

  function removeCurrent() {
    if (!map || activeIdRef.current === null) return
    const id = activeIdRef.current
    try { if (map.getLayer(id))   map.removeLayer(id) }   catch {}
    try { if (map.getSource(id))  map.removeSource(id) }  catch {}
    activeIdRef.current = null
  }

  // Waits for a source's tiles to be loaded, using both sourcedata and idle
  // events so we don't miss the case where the source loads before listeners attach.
  async function waitForSource(id) {
    if (map.isSourceLoaded(id)) return

    await new Promise(resolve => {
      // Double-check synchronously — race between the check above and listener setup
      if (map.isSourceLoaded(id)) { resolve(); return }

      let resolved = false
      const finish = () => {
        if (resolved) return
        resolved = true
        map.off('sourcedata', onData)
        map.off('idle', onIdle)
        clearTimeout(fallback)
        resolve()
      }

      const onData = (e) => {
        if (e.sourceId === id && map.isSourceLoaded(id)) finish()
      }
      // 'idle' fires after all pending tiles finish — reliable catch-all
      const onIdle = () => {
        if (map.isSourceLoaded(id)) finish()
      }

      map.on('sourcedata', onData)
      map.on('idle', onIdle)
      // Hard timeout so animation never gets permanently stuck
      const fallback = setTimeout(finish, 2000)
    })
  }

  async function goToFrame(idx) {
    const frames = framesRef.current
    if (!frames.length || !map) return
    const clamped = Math.max(0, Math.min(frames.length - 1, idx))
    const frame   = frames[clamped]
    const id      = `rv-${frame.time}`

    // Already showing this frame
    if (activeIdRef.current === id) {
      indexRef.current = clamped
      onFramesRef.current?.(frames, clamped)
      return
    }

    // Add source + layer if not already present (init() pre-adds the first frame)
    if (!map.getSource(id)) {
      map.addSource(id, {
        type:     'raster',
        tiles:    [tileUrl(frame.path)],
        tileSize: 512,
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

    // Wait for tiles to be ready before swapping so there's no blank flash
    await waitForSource(id)

    if (!mountedRef.current) return

    // Swap: show new, remove old
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