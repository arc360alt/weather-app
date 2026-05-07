import { useState, useEffect, useRef, useCallback } from 'react'

const GEMINI_MODEL = 'gemini-2.5-flash-lite'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`
const INIT_PROMPT = "Give me a brief summary of today's conditions and what to expect this week. Keep it to 2-3 sentences."
const REFRESH_MS = 30 * 60 * 1000

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

function wmoDesc(code) { return WMO_CODES[code] ?? `Unknown (code ${code})` }
function r(v) { return v != null ? String(Math.round(v)) : 'N/A' }
function windDir(deg) {
  return ['N','NE','E','SE','S','SW','W','NW'][Math.round((deg ?? 0) / 45) % 8]
}
function fmtHour(iso) {
  const h = new Date(iso).getHours()
  if (h === 0) return '12am'
  if (h === 12) return '12pm'
  return h > 12 ? `${h - 12}pm` : `${h}am`
}
function fmtDay(iso) {
  if (!iso) return 'N/A'
  const [y, m, day] = iso.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function fmtTime(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function buildSystemPrompt({ current: c, hourly: h, daily: d, locationName, units }) {
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
    `=== CURRENT CONDITIONS ===`,
    `Sky: ${wmoDesc(c?.weather_code)}`,
    `Temperature: ${r(c?.temperature_2m)}${tU} (feels like ${r(c?.apparent_temperature)}${tU})`,
    `Wind: ${r(c?.wind_speed_10m)} ${wU} from the ${windDir(c?.wind_direction_10m)}`,
    `Humidity: ${r(c?.relative_humidity_2m)}%`,
  ]
  if (c?.surface_pressure != null) lines.push(`Pressure: ${r(c.surface_pressure)} hPa`)
  if (c?.uv_index != null)         lines.push(`UV index: ${c.uv_index}`)
  if (c?.precipitation != null)    lines.push(`Precipitation right now: ${c.precipitation} ${pU}`)

  if (h?.time?.length) {
    const now = new Date()
    const start = Math.max(0, h.time.findIndex(t => new Date(t) >= now))
    const end = Math.min(start + 24, h.time.length)
    lines.push('', '=== NEXT 24 HOURS ===', 'Time   | Sky                   | Temp  | Precip% | Wind')
    for (let i = start; i < end; i++) {
      const label = i === start ? 'Now   ' : fmtHour(h.time[i]).padEnd(6)
      lines.push(
        `${label} | ${wmoDesc(h.weather_code?.[i]).padEnd(21)} | ${`${r(h.temperature_2m?.[i])}${tU}`.padEnd(5)} | ${String(h.precipitation_probability?.[i] ?? 0).padStart(3)}%     | ${r(h.wind_speed_10m?.[i])} ${wU}`
      )
    }
  }

  if (d?.time?.length) {
    lines.push('', '=== 7-DAY FORECAST ===')
    for (let i = 0; i < Math.min(7, d.time.length); i++) {
      const parts = [
        `${fmtDay(d.time[i])}: ${wmoDesc(d.weather_code?.[i])}`,
        `High ${r(d.temperature_2m_max?.[i])}${tU} / Low ${r(d.temperature_2m_min?.[i])}${tU}`,
      ]
      const probMax = d.precipitation_probability_max?.[i] ?? 0
      const probMin = d.precipitation_probability_min?.[i]
      if (probMax > 5) parts.push(
        probMin != null && probMin !== probMax ? `${probMin}–${probMax}% rain chance` : `${probMax}% rain chance`
      )
      const precip = d.precipitation_sum?.[i] ?? 0
      if (precip > 0) parts.push(`${precip} ${pU} expected`)
      const wMax = d.wind_speed_10m_max?.[i], wMin = d.wind_speed_10m_min?.[i]
      if (wMax != null) parts.push(wMin != null ? `Wind ${r(wMin)}–${r(wMax)} ${wU}` : `Wind up to ${r(wMax)} ${wU}`)
      if (d.uv_index_max?.[i] != null) parts.push(`UV max ${d.uv_index_max[i]}`)
      const rise = fmtTime(d.sunrise?.[i]), set = fmtTime(d.sunset?.[i])
      if (rise) parts.push(`Sunrise ${rise}`)
      if (set)  parts.push(`Sunset ${set}`)
      lines.push(parts.join(' | '))
    }
  }

  return lines.join('\n')
}

export default function WeatherAIPopup({ weatherData, locationName, units, isOpen, onClose }) {
  const [chatMessages, setChatMessages] = useState([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [liveText, setLiveText] = useState('')
  const [errorMsg, setErrorMsg] = useState(null)

  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)
  const didInit = useRef(false)
  const lastOpenedAt = useRef(null)
  const fullHistoryRef = useRef([])

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [chatMessages, liveText])

  useEffect(() => {
    if (isOpen && inputRef.current) setTimeout(() => inputRef.current?.focus(), 150)
  }, [isOpen])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    if (isOpen) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  useEffect(() => () => { abortRef.current?.abort() }, [])

  const streamResponse = useCallback(async (apiMessages, appendUserBubble) => {
    if (!apiKey) {
      setErrorMsg('No Gemini API key found. Add VITE_GEMINI_API_KEY to your .env file.')
      return
    }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    if (appendUserBubble) setChatMessages(prev => [...prev, appendUserBubble])
    setIsStreaming(true)
    setLiveText('')
    setErrorMsg(null)

    const systemPrompt = buildSystemPrompt({
      current: weatherData?.current,
      hourly: weatherData?.hourly,
      daily: weatherData?.daily,
      locationName,
      units,
    })

    const contents = apiMessages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }))

    try {
      const res = await fetch(`${GEMINI_URL}&key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { maxOutputTokens: 300, temperature: 0.7 },
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setErrorMsg(`Gemini error: ${body?.error?.message ?? `HTTP ${res.status}`}`)
        setIsStreaming(false)
        setLiveText('')
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let full = '', buf = ''

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
          try {
            const chunk = JSON.parse(payload)?.candidates?.[0]?.content?.parts?.[0]?.text
            if (chunk) { full += chunk; setLiveText(full) }
          } catch { /* skip malformed lines */ }
        }
      }

      if (full) {
        fullHistoryRef.current = [...apiMessages, { role: 'assistant', content: full }]
        setChatMessages(prev => [...prev, { role: 'assistant', content: full }])
      }
    } catch (err) {
      if (err.name !== 'AbortError') setErrorMsg(`Request failed: ${err.message}`)
    } finally {
      setIsStreaming(false)
      setLiveText('')
    }
  }, [weatherData, locationName, units, apiKey])

  const runInit = useCallback(() => {
    const initMsg = { role: 'user', content: INIT_PROMPT }
    fullHistoryRef.current = [initMsg]
    streamResponse([initMsg], null)
  }, [streamResponse])

  const runQuery = useCallback((text) => {
    const userMsg = { role: 'user', content: text }
    const newHistory = [...fullHistoryRef.current, userMsg]
    fullHistoryRef.current = newHistory
    streamResponse(newHistory, userMsg)
  }, [streamResponse])

  useEffect(() => {
    if (!isOpen || !weatherData?.current) return
    const now = Date.now()
    const stale = !lastOpenedAt.current || (now - lastOpenedAt.current >= REFRESH_MS)
    if (stale) {
      lastOpenedAt.current = now
      didInit.current = false
      setChatMessages([])
      setErrorMsg(null)
      fullHistoryRef.current = []
    }
    if (!didInit.current) {
      didInit.current = true
      runInit()
    }
  }, [isOpen, weatherData, runInit])

  const handleSubmit = (e) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')
    runQuery(text)
  }

  if (!isOpen) return null

  return (
    <>
      <div className="wai-overlay" onClick={onClose} aria-hidden="true" />
      <div className="wai-popup" role="dialog" aria-modal="true" aria-label="AI Weather Assistant">

        <div className="wai-header">
          <div className="wai-header-left">
            <svg className="wai-star-icon" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            <span className="wai-title">AI Weather</span>
            {locationName && <span className="wai-location">{locationName}</span>}
          </div>
          <button className="wai-close-btn" onClick={onClose} aria-label="Close AI Weather panel">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="wai-messages" ref={scrollRef}>
          {chatMessages.length === 0 && !isStreaming && !errorMsg && (
            <div className="wai-init-state">
              <div className="wai-typing-dots"><span /><span /><span /></div>
              <div className="wai-init-label">Analyzing weather data…</div>
            </div>
          )}

          {chatMessages.map((msg, i) => (
            <div key={i} className={`wai-bubble wai-bubble-${msg.role}`}>
              {msg.role === 'assistant' && (
                <svg className="wai-bubble-star" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              )}
              <span className="wai-bubble-text">{msg.content}</span>
            </div>
          ))}

          {isStreaming && (
            <div className="wai-bubble wai-bubble-assistant wai-bubble-streaming">
              <svg className="wai-bubble-star" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              {liveText
                ? <span className="wai-bubble-text">{liveText}<span className="wai-cursor" /></span>
                : <span className="wai-typing-dots"><span /><span /><span /></span>
              }
            </div>
          )}

          {errorMsg && !isStreaming && (
            <div className="wai-error-bubble">
              <span>⚠️</span>
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        <form className="wai-form" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className="wai-input"
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask about the weather…"
            disabled={isStreaming}
            maxLength={300}
            autoComplete="off"
          />
          <button
            className="wai-send-btn"
            type="submit"
            disabled={isStreaming || !input.trim()}
            aria-label="Send question"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>

      </div>
    </>
  )
}
