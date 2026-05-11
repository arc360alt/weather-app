import { useState, useEffect } from 'react'
import '../download.css'


const SHOWCASES = [
  { src: '/showcase1.png', label: 'Live Radar' },
  { src: '/showcase2.png', label: 'Weather Dashboard' },
  { src: '/showcase3.png', label: 'Air & Pollen' },
]

export default function DownloadPage({ onBack }) {
  const [release, setRelease] = useState(null)
  const [fetching, setFetching] = useState(true)

  useEffect(() => {
    fetch('https://api.github.com/repos/arc360alt/StormView-AndroidApp/releases/latest')
      .then(r => r.json())
      .then(data => {
        const apk = data.assets?.find(a => a.name.endsWith('.apk'))
        setRelease({
          version: data.tag_name,
          url: apk?.browser_download_url ?? null,
          sizeMb: apk ? (apk.size / 1024 / 1024).toFixed(1) : null,
          date: data.published_at ? new Date(data.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : null,
        })
        setFetching(false)
      })
      .catch(() => setFetching(false))
  }, [])

  return (
    <div className="dl-page">
      <button className="dl-back" onClick={onBack} aria-label="Back">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M19 12H5M12 5l-7 7 7 7"/>
        </svg>
        Back to StormView
      </button>

      {/* Hero */}
      <header className="dl-hero">
        <div className="dl-logo">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="dl-logo-icon">
            <circle cx="12" cy="12" r="2"/>
            <path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49"/>
            <path d="M20.07 3.93a10 10 0 0 1 0 16.14M3.93 20.07a10 10 0 0 1 0-16.14"/>
          </svg>
          <span className="dl-logo-text">StormView</span>
        </div>
        <div className="dl-badge">Android App</div>
        <p className="dl-tagline">The full StormView weather experience, live radar, AI forecasts, air quality, and real-time alerts, right on your phone.</p>
      </header>

      {/* Feature mockups */}
      <section className="dl-features">
        {SHOWCASES.map(({ src, label }) => (
          <div key={label} className="dl-phone">
            <div className="dl-phone-bar"><span className="dl-phone-camera" /></div>
            <img src={src} alt={label} className="dl-phone-img" />
            <div className="dl-phone-home" />
          </div>
        ))}
      </section>

      {/* Feature list */}
      <section className="dl-feature-list">
        {[
          { icon: '📡', title: 'Live Radar',        desc: 'Animated storm tracking with StormCast and NEXRAD data.' },
          { icon: '🌤',  title: 'Full Forecasts',    desc: 'Current conditions, hourly charts, and a 7-day outlook.' },
          { icon: '📍', title: 'GPS Integration',   desc: 'Automatically detects your location for instant local weather.' },
          { icon: '🤖', title: 'StormAI',           desc: 'Ask the AI assistant anything about your local forecast.' },
          { icon: '🌿', title: 'Air & Pollen',      desc: 'Real-time US AQI, PM2.5, and pollen levels for tree and grass.' },
          { icon: '⚠️', title: 'NWS Alerts',        desc: 'Live National Weather Service warnings and advisories on the map.' },
        ].map(({ icon, title, desc }) => (
          <div key={title} className="dl-feature-item">
            <span className="dl-feature-icon">{icon}</span>
            <div>
              <div className="dl-feature-title">{title}</div>
              <div className="dl-feature-desc">{desc}</div>
            </div>
          </div>
        ))}
      </section>

      {/* Download */}
      <section className="dl-download-section">

        {fetching ? (
          <div className="dl-btn dl-btn-loading">Checking for latest release…</div>
        ) : release?.url ? (
          <>
            <a href={release.url} className="dl-btn" download>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download APK
            </a>
            <div className="dl-release-meta">
              {release.sizeMb && <span>{release.sizeMb} MB</span>}
              {release.version && <span>ver: {release.version}</span>}
              {release.date && <span>{release.date}</span>}
            </div>
          </>
        ) : (
          <div className="dl-btn dl-btn-error">No release found</div>
        )}

      </section>

      <footer className="dl-footer">
        StormView is open source ·{' '}
        <a href="https://github.com/arc360alt/StormView-AndroidApp" target="_blank" rel="noopener noreferrer">
          View on GitHub
        </a>
      </footer>
    </div>
  )
}
