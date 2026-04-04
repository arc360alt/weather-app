import Fastify from 'fastify'
import cors from '@fastify/cors'
import { config } from './config.js'
import { NowcastService } from './services/nowcastService.js'

const app = Fastify({ logger: true })
await app.register(cors, { origin: true })

const nowcastService = new NowcastService()
// Restore the last build from disk (if < 20 min old) so tile requests are
// served instantly on restart.  Must complete before routes start handling requests.
await nowcastService.init()
// Proactively rebuild every 10 minutes, aligned to NEXRAD's update schedule.
nowcastService.startAutoRefresh()

app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }))

// ── /v1/nowcast/latest ────────────────────────────────────────────────────────
// Returns frame metadata with tileUrlTemplate fields the frontend uses to
// request individual map tiles.
app.get('/v1/nowcast/latest', async (req, reply) => {
  const data = await nowcastService.getNowcast(req.query || {})
  const query = new URLSearchParams()
  query.set('minutesAhead', String(data.minutesAhead))
  query.set('stepMinutes', String(data.stepMinutes))
  query.set('zoom', String(data.zoom))
  if (Array.isArray(data.usBbox) && data.usBbox.length === 4) {
    query.set('bbox', data.usBbox.join(','))
  }
  const suffix = `?${query.toString()}`

  const [west, south, east, north] = data.imageBounds
  const coordinates = [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ]

  return {
    generatedAt:     data.generatedAt,
    source:          data.source,
    usBbox:          data.usBbox,
    imageBounds:     data.imageBounds,
    zoom:            data.zoom,
    stepMinutes:     data.stepMinutes,
    minutesAhead:    data.minutesAhead,
    sourceLatestTime: data.sourceLatestTime,
    motion:          data.motion,
    tileRange:       data.tileRange,
    frameCount:      data.frameCount,
    frames: data.frames.map(f => ({
      index:           f.index,
      minutesAhead:    f.minutesAhead,
      validAt:         f.validAt,
      imageUrl:        `/v1/nowcast/frames/${f.index}.png${suffix}`,
      coordinates,
      // {z}/{x}/{y} placeholders the MapTiler SDK resolves when loading tiles
      tileUrlTemplate: `/v1/nowcast/tiles/${f.index}/{z}/{x}/{y}.png${suffix}`,
    })),
  }
})

app.get('/v1/nowcast/frames/:frame.png', async (req, reply) => {
  // Trigger an initial build only if nothing is cached yet; never block on it
  // once the service is warm — the LRU + disk caches handle everything else.
  if (!nowcastService.latest) {
    await nowcastService.getNowcast(req.query || {})
  }
  const frame = parseInt(req.params.frame, 10)
  if (!Number.isInteger(frame) || frame < 0) {
    reply.code(400)
    return { error: 'invalid_frame' }
  }

  const png = await nowcastService.getFramePng(frame)
  if (!png) {
    reply.code(404)
    return { error: 'frame_not_found' }
  }

  const etag = `"${nowcastService.latest.generatedAt}:f${frame}"`
  if (req.headers['if-none-match'] === etag) {
    reply.code(304)
    return reply.send()
  }

  reply.header('content-type', 'image/png')
  reply.header('cache-control', 'public, max-age=600')
  reply.header('etag', etag)
  reply.header('content-encoding', 'identity')  // Disable gzip; PNG is already compressed
  return reply.send(png)
})

// ── /v1/nowcast/tiles/:frame/:z/:x/:y.png ────────────────────────────────────
// Crop + colour a 256×256 radar tile from the cached composite and return PNG.
app.get('/v1/nowcast/tiles/:frame/:z/:x/:y.png', async (req, reply) => {
  // Trigger a build if nothing is cached yet
  if (!nowcastService.latest) {
    await nowcastService.getNowcast(req.query || {})
  }

  const frame = parseInt(req.params.frame, 10)
  const z     = parseInt(req.params.z, 10)
  const x     = parseInt(req.params.x, 10)
  const y     = parseInt(req.params.y, 10)

  if ([frame, z, x, y].some(n => !Number.isInteger(n) || n < 0)) {
    reply.code(400)
    return { error: 'invalid_tile_coords' }
  }

  const tileData = await nowcastService.getTile(frame, z, x, y, req.query || {})
  if (!tileData) {
    reply.code(503)
    return { error: 'nowcast_not_ready' }
  }

  const etag = `"${nowcastService.latest?.generatedAt}:${frame}:${z}:${x}:${y}"`
  if (req.headers['if-none-match'] === etag) {
    reply.code(304)
    return reply.send()
  }

  reply.header('content-type', 'image/png')
  reply.header('cache-control', 'public, max-age=600')
  reply.header('etag', etag)
  reply.header('content-encoding', 'identity')  // Disable gzip; PNG is already compressed
  return reply.send(tileData)
})

// ── /v1/nowcast/updates  (Server-Sent Events) ────────────────────────────────
// Keeps a persistent connection open; fires an 'update' event whenever a new
// nowcast is built so the frontend can refresh its frame list.
app.get('/v1/nowcast/updates', function (req, reply) {
  // Take full control of the socket so Fastify doesn't auto-close the response
  reply.hijack()
  const socket = req.socket

  socket.write(
    'HTTP/1.1 200 OK\r\n' +
    'Content-Type: text/event-stream\r\n' +
    'Cache-Control: no-cache\r\n' +
    'Access-Control-Allow-Origin: *\r\n' +
    'Access-Control-Allow-Methods: GET, OPTIONS\r\n' +
    'Access-Control-Allow-Headers: Content-Type\r\n' +
    'X-Accel-Buffering: no\r\n' +
    'Connection: keep-alive\r\n\r\n',
  )
  socket.write(': connected\n\n')

  // If a nowcast was already built before this client connected, send it
  // immediately so the frontend doesn't sit idle waiting for the next build cycle.
  if (nowcastService.latest && !socket.destroyed) {
    socket.write(`event: update\ndata: ${JSON.stringify({ generatedAt: nowcastService.latest.generatedAt })}\n\n`)
  }

  // Push 'update' events when a fresh nowcast is generated
  const unsub = nowcastService.onUpdate(generatedAt => {
    if (!socket.destroyed) {
      socket.write(`event: update\ndata: ${JSON.stringify({ generatedAt })}\n\n`)
    }
  })

  // Keepalive comment every 20 s to prevent proxies from timing out
  const iv = setInterval(() => {
    if (socket.destroyed) { clearInterval(iv); return }
    socket.write(': keepalive\n\n')
  }, 20000)

  socket.on('close', () => { clearInterval(iv); unsub() })
  socket.on('error', () => { clearInterval(iv); unsub() })
})

app.setErrorHandler((err, _req, reply) => {
  app.log.error(err)
  reply.code(500).send({ error: 'nowcast_error', message: err.message })
})

const start = async () => {
  await app.listen({ host: config.host, port: config.port })
  app.log.info(`storm-nowcast-api listening on http://${config.host}:${config.port}`)
}

start()
