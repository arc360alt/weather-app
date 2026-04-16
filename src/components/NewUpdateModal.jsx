import { useState, useEffect, useRef } from 'react'

const UPDATES = [
  {
    id:      'v2.0-2026-04-16',
    date:    'April 16, 2026',
    expires: '05-20-2026',
    version: 'v2.0',
    title:   'New homepage and mobile navigation!',
    items: [
      { icon: '🌐', text: 'Brought back the homepage and rewrote it.' },
      { icon: '💨', text: 'Remade mobile navigation to be easier and better.' },
      { icon: '🌡️', text: 'FINNALY fixed UV index not working on NWS mode.' },
      // { icon: '🌅', text: 'Fixed sunrise & sunset times using proper IANA timezone offset math' },
      // { icon: '🕐', text: 'Fixed all timestamp handling' },
      { icon: '🔧', text: 'Simple bug fixes' },
    ],
  },
]
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = (id) => `update-dismissed-${id}`

export default function NewUpdateModal({ forceOpen, onForceClose }) {
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)

  // Snapshot the update once on mount so toggling localStorage mid-session
  // never causes `update` to become undefined and unmount the modal.
  const updateRef = useRef(null)
  if (updateRef.current === null) {
    updateRef.current = forceOpen
        ? UPDATES[0] ?? null 
      : UPDATES.find(u => {
          if (new Date(u.expires) < new Date()) return false
          if (localStorage.getItem(STORAGE_KEY(u.id))) return false
          return true
        }) ?? null
  }
  // Re-snapshot when forceOpen changes (user opens from Settings button)
  const prevForceOpen = useRef(forceOpen)
  if (forceOpen && !prevForceOpen.current) {
      updateRef.current = UPDATES[0] ?? null 
  }
  prevForceOpen.current = forceOpen
  const update = updateRef.current

  // Derive dontShow directly from localStorage so it always reflects reality.
  // We use a state var only to force re-renders when the user toggles the checkbox.
  const [, rerender] = useState(0)
  const dontShow = update ? !!localStorage.getItem(STORAGE_KEY(update.id)) : false

  // Auto-show on first load (no forceOpen needed)
  useEffect(() => {
    if (!forceOpen && update) {
      const t = setTimeout(() => setVisible(true), 400)
      return () => clearTimeout(t)
    }
  }, [update?.id, forceOpen])

  // Show immediately when forceOpen is triggered
  useEffect(() => {
    if (forceOpen) {
      setClosing(false)
      setVisible(true)
    }
  }, [forceOpen])

  if (!update || !visible) return null

  // Write or remove localStorage immediately on toggle, then re-render to reflect new state
  const handleDontShowChange = (checked) => {
    if (checked) {
      localStorage.setItem(STORAGE_KEY(update.id), '1')
    } else {
      localStorage.removeItem(STORAGE_KEY(update.id))
    }
    rerender(n => n + 1)
  }

  const dismiss = () => {
    setClosing(true)
    setTimeout(() => {
      setVisible(false)
      onForceClose?.()
    }, 280)
  }

  return (
    <div
      className={`update-modal-backdrop ${closing ? 'update-backdrop-out' : 'update-backdrop-in'}`}
      onClick={(e) => e.target === e.currentTarget && dismiss()}
    >
      <div className={`update-modal ${closing ? 'update-modal-out' : 'update-modal-in'}`}>

        {/* Header */}
        <div className="update-modal-header">
          <div className="update-modal-header-left">
            <span className="update-version-badge">{update.version}</span>
            <span className="update-date">{update.date}</span>
          </div>
          <button className="update-close-btn" onClick={dismiss} aria-label="Close">✕</button>
        </div>

        {/* Title */}
        <div className="update-modal-title-wrap">
          <div className="update-modal-eyebrow">What's New</div>
          <h2 className="update-modal-title">{update.title}</h2>
        </div>

        {/* Changelog items */}
        <ul className="update-items">
          {update.items.map((item, i) => (
            <li key={i} className="update-item" style={{ animationDelay: `${0.08 + i * 0.055}s` }}>
              <span className="update-item-icon">{item.icon}</span>
              <span className="update-item-text">{item.text}</span>
            </li>
          ))}
        </ul>

        {/* Footer */}
        <div className="update-modal-footer">
          <label className="update-dont-show">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={e => handleDontShowChange(e.target.checked)}
            />
            <span>Don't show again</span>
          </label>
          <button className="update-ok-btn" onClick={dismiss}>Got it</button>
        </div>

      </div>
    </div>
  )
}