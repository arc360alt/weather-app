const SEVERITY_COLORS = {
  Extreme:  { bg: '#2d0a0a', border: '#ef4444', badge: '#ef4444', text: '#fca5a5' },
  Severe:   { bg: '#2d1a0a', border: '#f97316', badge: '#f97316', text: '#fdba74' },
  Moderate: { bg: '#2d250a', border: '#eab308', badge: '#eab308', text: '#fde047' },
  Minor:    { bg: '#0a1a2d', border: '#3b82f6', badge: '#3b82f6', text: '#93c5fd' },
  Unknown:  { bg: '#111d2e', border: '#1e3050', badge: '#6b8db5', text: '#6b8db5' },
}

function formatAlertTime(isoString) {
  if (!isoString) return '—'
  return new Date(isoString).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

export default function AlertModal({ alert, onClose }) {
  if (!alert) return null
  const p = alert.properties

  const severity = p.severity ?? 'Unknown'
  const colors   = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.Unknown

  // Close on backdrop click
  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="alert-modal-backdrop" onClick={handleBackdrop}>
      <div className="alert-modal" style={{ borderColor: colors.border }}>

        {/* Header */}
        <div className="alert-modal-header" style={{ background: colors.bg, borderBottomColor: colors.border }}>
          <div className="alert-modal-badges">
            <span className="alert-modal-badge" style={{ background: colors.badge + '22', color: colors.badge, border: `1px solid ${colors.badge}44` }}>
              {severity}
            </span>
            {p.certainty && (
              <span className="alert-modal-badge" style={{ background: 'rgba(255,255,255,0.04)', color: '#6b8db5', border: '1px solid #1e3050' }}>
                {p.certainty}
              </span>
            )}
            {p.urgency && (
              <span className="alert-modal-badge" style={{ background: 'rgba(255,255,255,0.04)', color: '#6b8db5', border: '1px solid #1e3050' }}>
                {p.urgency}
              </span>
            )}
          </div>
          <button className="alert-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Title */}
        <div className="alert-modal-title-wrap">
          <h2 className="alert-modal-title" style={{ color: colors.text }}>{p.event ?? 'Weather Alert'}</h2>
          {p.headline && <p className="alert-modal-headline">{p.headline}</p>}
        </div>

        {/* Meta grid */}
        <div className="alert-modal-meta">
          <div className="alert-modal-meta-item">
            <span className="alert-modal-meta-label">Issued by</span>
            <span className="alert-modal-meta-value">{p.senderName ?? '—'}</span>
          </div>
          <div className="alert-modal-meta-item">
            <span className="alert-modal-meta-label">Effective</span>
            <span className="alert-modal-meta-value">{formatAlertTime(p.effective)}</span>
          </div>
          {/*
          <div className="alert-modal-meta-item">
            <span className="alert-modal-meta-label">Onset</span>
            <span className="alert-modal-meta-value">{formatAlertTime(p.onset)}</span>
          </div>
          */}
          <div className="alert-modal-meta-item">
            <span className="alert-modal-meta-label">Expires</span>
            <span className="alert-modal-meta-value">{formatAlertTime(p.expires)}</span>
          </div>
          {/*
          {p.ends && (
            <div className="alert-modal-meta-item">
              <span className="alert-modal-meta-label">Ends</span>
              <span className="alert-modal-meta-value">{formatAlertTime(p.ends)}</span>
            </div>
          )}
            */}
          {p.areaDesc && (
            <div className="alert-modal-meta-item alert-modal-meta-full">
              <span className="alert-modal-meta-label">Affected Area</span>
              <span className="alert-modal-meta-value">{p.areaDesc}</span>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="alert-modal-body">
          {p.description && (
            <div className="alert-modal-section">
              <h3 className="alert-modal-section-title">Description</h3>
              <p className="alert-modal-text">{p.description}</p>
            </div>
          )}
          {p.instruction && (
            <div className="alert-modal-section">
              <h3 className="alert-modal-section-title">Instructions</h3>
              <p className="alert-modal-text">{p.instruction}</p>
            </div>
          )}
        </div>

        {/* NWS link */}
        {p['@id'] && (
          <div className="alert-modal-footer">
            <a href={p['@id']} target="_blank" rel="noreferrer" className="alert-modal-nws-link">
              View on NWS ↗
            </a>
          </div>
        )}

      </div>
    </div>
  )
}