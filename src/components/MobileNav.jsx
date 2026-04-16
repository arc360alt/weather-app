export default function MobileNav({ launched, onNavigate }) {
  return (
    <nav className="mobile-nav" aria-label="Main navigation">
      <button
        className={`mobile-nav-btn ${!launched ? 'mobile-nav-active' : ''}`}
        onClick={() => onNavigate('home')}
        aria-label="Home"
        aria-current={!launched ? 'page' : undefined}
      >
        <span className="mobile-nav-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </span>
        <span className="mobile-nav-label">Home</span>
      </button>

      <button
        className={`mobile-nav-btn ${launched ? 'mobile-nav-active' : ''}`}
        onClick={() => onNavigate('radar')}
        aria-label="Radar"
        aria-current={launched ? 'page' : undefined}
      >
        <span className="mobile-nav-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a10 10 0 0 1 10 10"/>
            <path d="M12 6a6 6 0 0 1 6 6"/>
            <path d="M12 10a2 2 0 0 1 2 2"/>
            <circle cx="12" cy="12" r="1" fill="currentColor"/>
          </svg>
        </span>
        <span className="mobile-nav-label">Radar</span>
      </button>
    </nav>
  )
}