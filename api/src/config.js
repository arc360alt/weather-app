const env = process.env

function envNum(key, fallback) {
  const raw = env[key]
  if (raw == null || raw === '') return fallback
  const num = Number(raw)
  return Number.isFinite(num) ? num : fallback
}

function envBbox(key, fallback) {
  const raw = env[key]
  if (!raw) return fallback
  const parts = raw.split(',').map(Number)
  if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) return fallback
  return parts
}

export const config = {
  host: env.HOST || '0.0.0.0',
  port: envNum('PORT', 8788),
  cacheTtlMs: envNum('CACHE_TTL_MS', 600000),
  usBbox: envBbox('US_BBOX', [-125, 24, -66, 50]),
  radarZoom: envNum('RADAR_ZOOM', 4),
  historySteps: envNum('HISTORY_STEPS', 6),
  stepMinutes: envNum('STEP_MINUTES', 10),
  maxForecastMinutes: envNum('MAX_FORECAST_MINUTES', 120),
  // Adaptive zoom up to 8 for viewport-bbox tile requests (bbox keeps tile count small).
  // Full-US composites should never exceed 6; the frontend enforces this via BUNDLED_NOWCAST_ZOOM.
  maxNowcastZoom: envNum('MAX_NOWCAST_ZOOM', 8),
  tileFetchConcurrency: envNum('TILE_FETCH_CONCURRENCY', 48),
  // Disk directory for rendered tile PNGs and nowcast manifest.
  // Persists tiles across restarts so the first request after a restart is instant.
  tileCacheDir: env.TILE_CACHE_DIR || '.cache',
  // How often (ms) to proactively rebuild the nowcast — matches NEXRAD update rate.
  nexradRefreshMs: envNum('NEXRAD_REFRESH_MS', 10 * 60 * 1000),
  tileSize: 256,
  tileBase: 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0',
}
