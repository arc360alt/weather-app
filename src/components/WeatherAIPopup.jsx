import { useState, useEffect, useRef, useCallback } from 'react'

const INIT_PROMPT =
  "Give me a brief summary of today's conditions and what to expect this week. Keep it to 2-3 sentences."

const REFRESH_MS = 30 * 60 * 1000 // 30 minutes

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

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }

  useEffect(() => { scrollToBottom() }, [chatMessages, liveText])

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 150)
    }
  }, [isOpen])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    if (isOpen) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  // Stream helper shared by both init and follow-up queries.
  // `seedMessages` are sent to the API but only `appendToUI` controls
  // whether a user bubble is added to the visible chat.
  const streamResponse = useCallback(async (apiMessages, appendUserBubble) => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    if (appendUserBubble) {
      setChatMessages(prev => [...prev, appendUserBubble])
    }

    setIsStreaming(true)
    setLiveText('')
    setErrorMsg(null)

    try {
      const res = await fetch('/api/weather-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          messages: apiMessages,
          weatherData: {
            current: weatherData?.current,
            daily: weatherData?.daily,
            locationName,
            units,
          },
        }),
      })

      if (!res.ok) throw new Error(`API error ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let full = ''
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)
          if (payload === '[DONE]') continue
          try {
            const parsed = JSON.parse(payload)
            if (parsed.error) {
              setErrorMsg(parsed.error)
              full = ''
            } else if (parsed.content) {
              full += parsed.content
              setLiveText(full)
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }

      if (full) {
        setChatMessages(prev => [...prev, { role: 'assistant', content: full }])
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setErrorMsg(`Could not reach the AI API. Is the server running? (${err.message})`)
      }
    } finally {
      setIsStreaming(false)
      setLiveText('')
    }
  }, [weatherData, locationName, units])

  // Silent init: sends the prompt to the API but shows NO user bubble.
  const runInit = useCallback(() => {
    streamResponse([{ role: 'user', content: INIT_PROMPT }], null)
  }, [streamResponse])

  // Follow-up: shows a user bubble + AI reply.
  const runQuery = useCallback((history, text) => {
    const userMsg = { role: 'user', content: text }
    streamResponse([...history, userMsg], userMsg)
  }, [streamResponse])

  // On every open: check if a refresh is due, then init if needed.
  useEffect(() => {
    if (!isOpen || !weatherData?.current) return

    const now = Date.now()
    const stale = !lastOpenedAt.current || (now - lastOpenedAt.current >= REFRESH_MS)

    if (stale) {
      lastOpenedAt.current = now
      didInit.current = false
      setChatMessages([])
      setErrorMsg(null)
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
    runQuery(chatMessages, text)
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
