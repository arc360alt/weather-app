export default function RadarLegend() {
  const steps = [
    { color: '#a8d8f0', label: 'Trace' },
    { color: '#3b9fe8', label: 'Light' },
    { color: '#29b54a', label: 'Moderate' },
    { color: '#f5e642', label: 'Heavy' },
    { color: '#e83d2a', label: 'Intense' },
    { color: '#ffffff', label: 'Extreme' },
  ]

  return (
    <div className="radar-legend">
      <span className="radar-legend-title">Intensity</span>
      <div className="radar-legend-scale">
        {steps.map(s => (
          <div key={s.label} className="radar-legend-step">
            <div className="radar-legend-swatch" style={{ background: s.color }} />
            <span className="radar-legend-label">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}