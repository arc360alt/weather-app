import { useState } from 'react'
import AlertModal from './AlertModal'

const SEVERITY_STYLES = {
  Extreme:  { bg: '#2d0a0a', border: '#ef4444', icon: '🚨', color: '#fca5a5' },
  Severe:   { bg: '#2d1a0a', border: '#f97316', icon: '⚠️', color: '#fdba74' },
  Moderate: { bg: '#2d250a', border: '#eab308', icon: '⚠️', color: '#fde047' },
  Minor:    { bg: '#0a1a2d', border: '#3b82f6', icon: 'ℹ️', color: '#93c5fd' },
  Unknown:  { bg: '#111d2e', border: '#1e3050', icon: 'ℹ️', color: '#6b8db5' },
}

export default function AlertBanner({ alerts }) {
  const [selectedAlert, setSelectedAlert] = useState(null)

  if (!alerts || alerts.length === 0) return null

  return (
    <>
      <div className="alert-banner-wrap">
        {alerts.map((alert, i) => {
          const p        = alert.properties
          const severity = p.severity ?? 'Unknown'
          const style    = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.Unknown

          return (
            <div
              key={p.id ?? i}
              className="alert-banner-item"
              style={{ background: style.bg, borderLeftColor: style.border }}
            >
              <span className="alert-banner-icon">{style.icon}</span>
              <div className="alert-banner-content">
                <span className="alert-banner-event" style={{ color: style.color }}>
                  {p.event ?? 'Weather Alert'}
                </span>
                {p.headline && (
                  <span className="alert-banner-headline">{p.headline}</span>
                )}
              </div>
              <button
                className="alert-banner-btn"
                style={{ borderColor: style.border, color: style.color }}
                onClick={() => setSelectedAlert(alert)}
              >
                Read More
              </button>
            </div>
          )
        })}
      </div>

      {selectedAlert && (
        <AlertModal
          alert={selectedAlert}
          onClose={() => setSelectedAlert(null)}
        />
      )}
    </>
  )
}