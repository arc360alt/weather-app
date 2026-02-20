import { useRef, useState, useEffect } from 'react'

function formatTime(unixSec) {
  return new Date(unixSec * 1000).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function formatDate(unixSec) {
  const d     = new Date(unixSec * 1000)
  const today = new Date()
  const tom   = new Date(); tom.setDate(today.getDate() + 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === tom.toDateString())   return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function RadarControls({ frames, currentIndex, playing, onSeek, onTogglePlay }) {
  const [localIndex, setLocalIndex] = useState(0)
  const isDragging = useRef(false)

  // Sync animation ticks into local state — but never while dragging
  useEffect(() => {
    if (!isDragging.current) setLocalIndex(currentIndex)
  }, [currentIndex])

  // Initialise when frames first arrive
  useEffect(() => {
    if (frames?.length > 0) setLocalIndex(currentIndex)
  }, [frames?.length]) // eslint-disable-line

  if (!frames || frames.length === 0) return null

  const nowSec    = Date.now() / 1000
  const pastCount = frames.filter(f => f.time < nowSec).length
  const pastPct   = Math.max(5, Math.min(95, (pastCount / frames.length) * 100))
  const safeIdx   = Math.max(0, Math.min(frames.length - 1, localIndex))
  const frame     = frames[safeIdx]
  const isPast    = frame?.time < nowSec
  const label     = frame ? `${formatDate(frame.time)} · ${formatTime(frame.time)}` : ''
  const fillPct   = frames.length > 1 ? (safeIdx / (frames.length - 1)) * 100 : 0

  const jumpToNow = () => onSeek(frames.findIndex((f, i) =>
    i === frames.length - 1 || frames[i + 1].time > nowSec
  ))

  return (
    <div className="radar-bar">

      <button
        className="radar-play-btn"
        onClick={onTogglePlay}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        
        {playing
          ? <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6"  y="4" width="4" height="16"/>
              <rect x="14" y="4" width="4" height="16"/>
            </svg>
          : <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
        }
      </button>

      <div className="radar-timeline">

        <div className="radar-zone-labels">
          <span style={{ width: `${pastPct}%` }}>Past</span>
          <span style={{ width: `${100 - pastPct}%`, textAlign: 'right' }}>Forecast</span>
        </div>

        <div className="radar-track">
          <div className="radar-track-bg">
            <div className="radar-zone-fill past"    style={{ width: `${pastPct}%` }} />
            <div className="radar-zone-fill nowcast" style={{ width: `${100 - pastPct}%` }} />
            <div className="radar-now-marker" style={{ left: `${pastPct}%` }} />
          </div>
          <div className="radar-progress" style={{ width: `${fillPct}%` }} />
          <input
            type="range"
            className="radar-slider"
            min={0}
            max={frames.length - 1}
            value={safeIdx}
            onChange={e => setLocalIndex(parseInt(e.target.value))}
            onPointerDown={() => { isDragging.current = true }}
            onPointerUp={e => {
              isDragging.current = false
              const idx = parseInt(e.target.value)
              setLocalIndex(idx)
              onSeek(idx)
            }}
          />
        </div>

        <div className="radar-time-label">
          <span className={`radar-badge ${isPast ? 'past' : 'nowcast'}`}>
            {isPast ? '● Past' : '▲ Forecast'}
          </span>
          <span className="radar-time-text">{label}</span>
          <button className="radar-now-btn" onClick={jumpToNow} title="Jump to now">
            NOW
          </button>
        </div>

      </div>
    </div>
  )
}