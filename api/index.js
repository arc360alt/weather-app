const express = require('express')
const cors    = require('cors')

const app = express()
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || origin.endsWith('.arc360hub.com') || origin === 'https://arc360hub.com') {
      cb(null, true)
    } else {
      cb(new Error('CORS: origin not allowed'))
    }
  },
}))
app.use(express.json({ limit: '2mb' }))

const GOOGLE_KEY   = process.env.GOOGLE_API_KEY || ''
const GEMINI_KEY   = process.env.GEMINI_API_KEY || ''
const MAPTILER_KEY = process.env.MAPTILER_KEY   || ''
const GEMINI_MODEL = 'gemini-2.5-flash-lite'

// ── Frontend config ────────────────────────────────────────────────────────────

app.get('/api/config', (_req, res) => {
  res.json({ maptilerKey: MAPTILER_KEY })
})

// ── Google Weather ─────────────────────────────────────────────────────────────

app.get('/api/google/weather-current', async (req, res) => {
  const { lat, lon } = req.query
  if (!lat || !lon)   return res.status(400).json({ error: 'lat and lon required' })
  if (!GOOGLE_KEY)    return res.status(503).json({ error: 'GOOGLE_API_KEY not set on server' })
  try {
    const r = await fetch(
      `https://weather.googleapis.com/v1/currentConditions:lookup` +
      `?key=${GOOGLE_KEY}&location.latitude=${lat}&location.longitude=${lon}`
    )
    const json = r.ok ? await r.json() : null
    if (!json) return res.status(502).json({ error: `Google returned ${r.status}` })
    res.json(json)
  } catch (e) { res.status(502).json({ error: e.message }) }
})

app.get('/api/google/weather-forecast', async (req, res) => {
  const { lat, lon, hours = 24 } = req.query
  if (!lat || !lon)   return res.status(400).json({ error: 'lat and lon required' })
  if (!GOOGLE_KEY)    return res.status(503).json({ error: 'GOOGLE_API_KEY not set on server' })
  try {
    const r = await fetch(
      `https://weather.googleapis.com/v1/forecast/hours:lookup` +
      `?key=${GOOGLE_KEY}&location.latitude=${lat}&location.longitude=${lon}` +
      `&hours=${hours}&pageSize=24`
    )
    const json = r.ok ? await r.json() : null
    if (!json) return res.status(502).json({ error: `Google returned ${r.status}` })
    res.json(json)
  } catch (e) { res.status(502).json({ error: e.message }) }
})

// ── Google Air Quality ─────────────────────────────────────────────────────────

app.post('/api/google/air-quality', async (req, res) => {
  const { lat, lon } = req.body
  if (lat == null || lon == null) return res.status(400).json({ error: 'lat and lon required' })
  if (!GOOGLE_KEY)                return res.status(503).json({ error: 'GOOGLE_API_KEY not set on server' })
  try {
    const r = await fetch(
      `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${GOOGLE_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: { latitude: lat, longitude: lon },
          extraComputations: ['LOCAL_AQI', 'POLLUTANT_CONCENTRATION'],
        }),
      }
    )
    const json = r.ok ? await r.json() : null
    if (!json) return res.status(502).json({ error: `Google returned ${r.status}` })
    res.json(json)
  } catch (e) { res.status(502).json({ error: e.message }) }
})

// ── Google Pollen ──────────────────────────────────────────────────────────────

app.get('/api/google/pollen', async (req, res) => {
  const { lat, lon, days = 5 } = req.query
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' })
  if (!GOOGLE_KEY)  return res.status(503).json({ error: 'GOOGLE_API_KEY not set on server' })
  try {
    const r = await fetch(
      `https://pollen.googleapis.com/v1/forecast:lookup` +
      `?key=${GOOGLE_KEY}&location.latitude=${lat}&location.longitude=${lon}&days=${days}`
    )
    const json = r.ok ? await r.json() : null
    if (!json) return res.status(502).json({ error: `Google returned ${r.status}` })
    res.json(json)
  } catch (e) { res.status(502).json({ error: e.message }) }
})

// ── Gemini (SSE streaming) ─────────────────────────────────────────────────────

app.post('/api/google/gemini', async (req, res) => {
  const { systemPrompt, contents, generationConfig } = req.body
  if (!contents?.length) return res.status(400).json({ error: 'contents required' })
  if (!GEMINI_KEY)       return res.status(503).json({ error: 'GEMINI_API_KEY not set on server' })

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-store')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
          contents,
          generationConfig: generationConfig ?? { maxOutputTokens: 300, temperature: 0.7 },
        }),
      }
    )

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}))
      res.write(`data: ${JSON.stringify({ error: err?.error?.message ?? `HTTP ${upstream.status}` })}\n\n`)
      return res.end()
    }

    const reader  = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (!payload || payload === '[DONE]') continue
        res.write(`data: ${payload}\n\n`)
      }
    }
    res.write('data: [DONE]\n\n')
    res.end()
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`)
    res.end()
  }
})

// ── Health ─────────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    google:   GOOGLE_KEY   ? 'configured' : 'missing',
    gemini:   GEMINI_KEY   ? 'configured' : 'missing',
    maptiler: MAPTILER_KEY ? 'configured' : 'missing',
  })
})

module.exports = app

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3001
  app.listen(PORT, () => console.log(`API proxy → http://localhost:${PORT}`))
}
