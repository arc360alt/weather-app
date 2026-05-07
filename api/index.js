import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors({ origin: 'https://weather.arc360hub.com' }))
app.use(express.json({ limit: '2mb' }))

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const MODEL = process.env.OLLAMA_MODEL || 'gemma3:1b-it-qat'

const WMO_CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail',
}

function wmoDesc(code) {
  return WMO_CODES[code] ?? `Unknown (code ${code})`
}

function r(v, digits = 0) {
  if (v == null) return 'N/A'
  return digits === 0 ? String(Math.round(v)) : v.toFixed(digits)
}

function windDir(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round((deg ?? 0) / 45) % 8]
}

function fmtHour(iso) {
  const d = new Date(iso)
  const h = d.getHours()
  if (h === 0) return '12am'
  if (h === 12) return '12pm'
  return h > 12 ? `${h - 12}pm` : `${h}am`
}

function fmtDay(iso) {
  if (!iso) return 'N/A'
  const [y, m, day] = iso.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

function fmtTime(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function buildSystemPrompt(weatherData) {
  const { current: c, hourly: h, daily: d, locationName, units } = weatherData
  const tU = units === 'imperial' ? '°F' : '°C'
  const wU = units === 'imperial' ? 'mph' : 'km/h'
  const pU = units === 'imperial' ? 'in' : 'mm'

  const lines = [
    `You are a friendly, casual weather assistant for ${locationName || 'this location'}.`,
    ``,
    `LANGUAGE RULES — follow these strictly:`,
    `- All data is forecast data and inherently uncertain. Never say "will", "is going to", or "are expected". Always hedge: "looks like", "could see", "might", "there's a chance of", "models are showing", "should be around".`,
    `- Write natural, grammatically correct English. Match plurals to quantities ("1 inch", not "1 inches"). Reread each sentence before finishing it.`,
    `- Be conversational and concise — like a text from a friend who checked the weather app. Under 80 words unless asked for more.`,
    `- Plain text only. No markdown, bullet points, or headers.`,
    ``,
  ]

  // ── Current conditions ───────────────────────────────────────────────────
  lines.push('=== CURRENT CONDITIONS ===')
  lines.push(`Sky: ${wmoDesc(c?.weather_code)}`)
  lines.push(`Temperature: ${r(c?.temperature_2m)}${tU} (feels like ${r(c?.apparent_temperature)}${tU})`)
  lines.push(`Wind: ${r(c?.wind_speed_10m)} ${wU} from the ${windDir(c?.wind_direction_10m)}`)
  lines.push(`Humidity: ${r(c?.relative_humidity_2m)}%`)
  if (c?.surface_pressure != null) lines.push(`Pressure: ${r(c.surface_pressure)} hPa`)
  if (c?.uv_index != null)         lines.push(`UV index: ${c.uv_index}`)
  if (c?.precipitation != null)    lines.push(`Precipitation right now: ${r(c.precipitation, 2)} ${pU}`)

  // ── Next 24 hours (hourly) ───────────────────────────────────────────────
  if (h?.time?.length) {
    const now = new Date()
    const startIdx = Math.max(0, h.time.findIndex(t => new Date(t) >= now))
    const end = Math.min(startIdx + 24, h.time.length)

    lines.push('', '=== NEXT 24 HOURS (hourly) ===')
    lines.push('Time   | Sky                   | Temp  | Precip% | Wind')

    for (let i = startIdx; i < end; i++) {
      const sky   = wmoDesc(h.weather_code?.[i]).padEnd(21)
      const temp  = `${r(h.temperature_2m?.[i])}${tU}`.padEnd(5)
      const prob  = String(h.precipitation_probability?.[i] ?? 0).padStart(3) + '%'
      const wind  = `${r(h.wind_speed_10m?.[i])} ${wU}`
      const label = (i === startIdx ? 'Now   ' : fmtHour(h.time[i]).padEnd(6))
      lines.push(`${label} | ${sky} | ${temp} | ${prob}     | ${wind}`)
    }
  }

  // ── 7-day daily forecast ─────────────────────────────────────────────────
  if (d?.time?.length) {
    lines.push('', '=== 7-DAY DAILY FORECAST ===')

    for (let i = 0; i < Math.min(7, d.time.length); i++) {
      const day       = fmtDay(d.time[i])
      const sky       = wmoDesc(d.weather_code?.[i])
      const hi        = `${r(d.temperature_2m_max?.[i])}${tU}`
      const lo        = `${r(d.temperature_2m_min?.[i])}${tU}`
      const probMax   = d.precipitation_probability_max?.[i] ?? 0
      const probMin   = d.precipitation_probability_min?.[i] ?? null
      const precip    = d.precipitation_sum?.[i] ?? 0
      const windMax   = d.wind_speed_10m_max?.[i]
      const windMin   = d.wind_speed_10m_min?.[i]
      const uvMax     = d.uv_index_max?.[i]
      const rise      = fmtTime(d.sunrise?.[i])
      const set       = fmtTime(d.sunset?.[i])

      const parts = [`${day}: ${sky}`, `High ${hi} / Low ${lo}`]

      if (probMax > 5) {
        parts.push(probMin != null && probMin !== probMax
          ? `${probMin}–${probMax}% rain chance`
          : `${probMax}% rain chance`)
      }
      if (precip > 0) parts.push(`${r(precip, 2)} ${pU} expected`)

      if (windMax != null) {
        parts.push(windMin != null
          ? `Wind ${r(windMin)}–${r(windMax)} ${wU}`
          : `Wind up to ${r(windMax)} ${wU}`)
      }

      if (uvMax != null) parts.push(`UV max ${uvMax}`)
      if (rise)          parts.push(`Sunrise ${rise}`)
      if (set)           parts.push(`Sunset ${set}`)

      lines.push(parts.join(' | '))
    }
  }

  return lines.join('\n')
}

app.post('/api/weather-ai', async (req, res) => {
  const { messages, weatherData } = req.body

  if (!Array.isArray(messages) || !messages.length || !weatherData) {
    return res.status(400).json({ error: 'Missing required fields: messages, weatherData' })
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-store')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const systemContent = buildSystemPrompt(weatherData)

  try {
    const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: systemContent }, ...messages],
        stream: true,
        options: {
          temperature: 0.7,
          num_predict: 250,
          top_p: 0.9,
        },
      }),
    })

    if (!ollamaRes.ok) {
      const errText = await ollamaRes.text().catch(() => '')
      res.write(`data: ${JSON.stringify({ error: `Ollama returned ${ollamaRes.status}: ${errText.slice(0, 200)}` })}\n\n`)
      return res.end()
    }

    const reader = ollamaRes.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const chunk = JSON.parse(line)
          if (chunk.message?.content) {
            res.write(`data: ${JSON.stringify({ content: chunk.message.content })}\n\n`)
          }
          if (chunk.done) {
            res.write('data: [DONE]\n\n')
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    res.end()
  } catch (err) {
    const isRefused = err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED'
    const msg = isRefused
      ? `Cannot connect to Ollama at ${OLLAMA_URL}. Make sure Ollama is running: ollama serve, then pull the model: ollama pull ${MODEL}`
      : `Error: ${err.message}`
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`)
    res.end()
  }
})

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', model: MODEL, ollama: OLLAMA_URL })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Weather AI API → http://localhost:${PORT}`)
  console.log(`Ollama target  → ${OLLAMA_URL}`)
  console.log(`Model          → ${MODEL}`)
})
