import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const MODEL = process.env.OLLAMA_MODEL || 'llama3.2:1b'

const WMO_CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
}

function wmoDesc(code) {
  return WMO_CODES[code] ?? `Conditions (code ${code})`
}

function round(v) {
  return v != null ? Math.round(v) : null
}

function windDir(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round((deg ?? 0) / 45) % 8]
}

function fmtTime(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function fmtDay(iso) {
  if (!iso) return null
  const [y, m, d] = iso.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

function buildSystemPrompt(weatherData) {
  const { current: c, daily: d, locationName, units } = weatherData
  const tU = units === 'imperial' ? '°F' : '°C'
  const wU = units === 'imperial' ? 'mph' : 'km/h'
  const pU = units === 'imperial' ? 'in' : 'mm'

  const lines = [
    `You are a helpful, friendly weather assistant for ${locationName || 'this location'}.`,
    `Be conversational, accurate, and concise. Use plain text only — no markdown, bullet points, or headers.`,
    `Keep responses under 100 words unless the user asks for more detail.`,
    `Speak like a knowledgeable friend who knows the local weather inside-out.`,
    ``,
    `=== CURRENT CONDITIONS ===`,
    `Conditions: ${wmoDesc(c?.weather_code)}`,
    `Temperature: ${round(c?.temperature_2m)}${tU} (feels like ${round(c?.apparent_temperature)}${tU})`,
    `Wind: ${round(c?.wind_speed_10m)} ${wU} from the ${windDir(c?.wind_direction_10m)}`,
    `Humidity: ${c?.relative_humidity_2m}%`,
    c?.surface_pressure ? `Pressure: ${round(c.surface_pressure)} hPa` : null,
    c?.uv_index != null ? `UV Index: ${c.uv_index}` : null,
    c?.precipitation != null ? `Current precipitation: ${c.precipitation} ${pU}` : null,
  ].filter(Boolean)

  if (d?.time?.length) {
    lines.push('', '=== 7-DAY FORECAST ===')
    for (let i = 0; i < Math.min(7, d.time.length); i++) {
      const parts = [
        fmtDay(d.time[i]),
        wmoDesc(d.weather_code?.[i]),
        `High ${round(d.temperature_2m_max?.[i])}${tU}`,
        `Low ${round(d.temperature_2m_min?.[i])}${tU}`,
      ]
      if ((d.precipitation_probability_max?.[i] ?? 0) > 10) {
        parts.push(`${d.precipitation_probability_max[i]}% rain chance`)
      }
      if ((d.precipitation_sum?.[i] ?? 0) > 0) {
        parts.push(`${d.precipitation_sum[i]}${pU} precip`)
      }
      lines.push(parts.join(' — '))
    }
  }

  const rise = fmtTime(d?.sunrise?.[0])
  const set = fmtTime(d?.sunset?.[0])
  if (rise || set) {
    lines.push('')
    if (rise) lines.push(`Today's sunrise: ${rise}`)
    if (set) lines.push(`Today's sunset: ${set}`)
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

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', model: MODEL, ollama: OLLAMA_URL })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Weather AI API → http://localhost:${PORT}`)
  console.log(`Ollama target  → ${OLLAMA_URL}`)
  console.log(`Model          → ${MODEL}`)
})
