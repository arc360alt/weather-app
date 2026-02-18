import { useState, useEffect, useRef } from 'react'

const APP_NAME = 'StormView'

const FEATURES = [
  'Live radar animation',
  'Real-time precipitation',
  'Wind speed & direction',
  'Atmospheric pressure maps',
  'Interactive MapTiler maps',
  '7-day hourly forecasts',
  'Customisable map styles',
  'Click-to-pin any location',
  'Temperature overlays',
  'Zip code & city search',
  `Free and open source`,
  `ZERO ads and fast on low end hardware`
]

const TYPE_SPEED   = 48   // ms per character typed
const DELETE_SPEED = 28   // ms per character deleted
const HOLD_MS      = 2200 // how long to hold before deleting

function useTypewriter(strings) {
  const [displayed, setDisplayed] = useState('')
  const [featureIdx, setFeatureIdx] = useState(0)
  const [phase, setPhase] = useState('typing') // typing | holding | deleting
  const timeoutRef = useRef(null)

  useEffect(() => {
    const current = strings[featureIdx]

    if (phase === 'typing') {
      if (displayed.length < current.length) {
        timeoutRef.current = setTimeout(() => {
          setDisplayed(current.slice(0, displayed.length + 1))
        }, TYPE_SPEED)
      } else {
        timeoutRef.current = setTimeout(() => setPhase('holding'), HOLD_MS)
      }
    }

    if (phase === 'holding') {
      setPhase('deleting')
    }

    if (phase === 'deleting') {
      if (displayed.length > 0) {
        timeoutRef.current = setTimeout(() => {
          setDisplayed(d => d.slice(0, -1))
        }, DELETE_SPEED)
      } else {
        // Pick a random next string that isn't the current one
        let next
        do { next = Math.floor(Math.random() * strings.length) }
        while (next === featureIdx)
        setFeatureIdx(next)
        setPhase('typing')
      }
    }

    return () => clearTimeout(timeoutRef.current)
  }, [displayed, phase, featureIdx, strings])

  return { displayed, phase }
}

function useTitleTypewriter(text) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)
  const timeoutRef = useRef(null)

  useEffect(() => {
    if (displayed.length < text.length) {
      timeoutRef.current = setTimeout(() => {
        setDisplayed(text.slice(0, displayed.length + 1))
      }, 90)
    } else {
      setDone(true)
    }
    return () => clearTimeout(timeoutRef.current)
  }, [displayed, text])

  return { displayed, done }
}

export default function Home({ onLaunch }) {
  const { displayed: titleText, done: titleDone } = useTitleTypewriter(APP_NAME)
  const { displayed: featureText, phase } = useTypewriter(FEATURES)
  const [showFeature, setShowFeature] = useState(false)

  // Start feature typewriter after title finishes
  useEffect(() => {
    if (titleDone) {
      const t = setTimeout(() => setShowFeature(true), 400)
      return () => clearTimeout(t)
    }
  }, [titleDone])

  return (
    <div className="home-root">

      {/* Atmospheric background grid */}
      <div className="home-grid" aria-hidden="true" />
      <div className="home-glow" aria-hidden="true" />

      {/* Main content */}
      <main className="home-main">

        <h1 className="home-title">
          {titleText}
          <span className={`home-cursor ${titleDone ? 'home-cursor-blink' : ''}`}>|</span>
        </h1>

        <div className="home-feature-wrap">
          {showFeature && (
            <p className="home-feature">
              <span className="home-feature-label">Features —</span>
              <span className="home-feature-text">
                {featureText}
                <span className={`home-cursor home-cursor-feature ${phase === 'holding' ? 'home-cursor-blink' : ''}`}>|</span>
              </span>
            </p>
          )}
        </div>

        <button className="home-launch-btn" onClick={onLaunch}>
          <span>Launch UI</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>

      </main>

      {/* Footer */}
      <footer className="home-footer">
        <span className="home-footer-brand">{APP_NAME}</span>
        <nav className="home-footer-links">
          <a href="#" onClick={e => { e.preventDefault(); onLaunch() }}>Launch</a>
          <a href="https://open-meteo.com" target="_blank" rel="noreferrer">Weather Data</a>
          <a href="https://www.maptiler.com" target="_blank" rel="noreferrer">Maps</a>
          <a href="https://github.com/arc360alt/weather-app" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </footer>

    </div>
  )
}