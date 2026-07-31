#!/usr/bin/env node
/**
 * The sync relay.
 *
 * Deliberately dumb: it forwards Yjs updates between everyone in a room and
 * keeps the latest state in memory so a peer joining an empty room catches up.
 * It never parses a trip, so there is nothing here to keep in step with the
 * document schema.
 *
 * The app does not need this to work — without it, trips are stored locally
 * and shared by link. Run it when you want several people editing the same
 * trip live:
 *
 *     npm run relay
 *     VITE_RELAY_URL=ws://localhost:1234 npm run dev
 *
 * Not suitable for the public internet as-is: any client that knows a room
 * name can read and write it. Put it behind auth before exposing it.
 */

import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT ?? 1234)
const HOST = process.env.HOST ?? '127.0.0.1'

/** room -> { clients:Set<ws>, updates:Uint8Array[] } */
const rooms = new Map()

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }))
    return
  }
  res.writeHead(426)
  res.end('This endpoint speaks WebSocket only.')
})

const wss = new WebSocketServer({ server })

wss.on('connection', (ws, req) => {
  const name = decodeURIComponent((req.url ?? '/').slice(1).split('?')[0]) || 'default'
  const room = rooms.get(name) ?? { clients: new Set(), updates: [] }
  rooms.set(name, room)
  room.clients.add(ws)

  // Catch the newcomer up on everything the room has seen.
  for (const update of room.updates) {
    if (ws.readyState === ws.OPEN) ws.send(update)
  }

  ws.on('message', (data) => {
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data)
    room.updates.push(payload)
    // Bound the log so a long-lived room does not grow without limit. Yjs
    // updates are idempotent and commutative, so dropping the oldest costs
    // history, not correctness — the newest state still converges.
    if (room.updates.length > 4096) room.updates.splice(0, room.updates.length - 2048)

    for (const peer of room.clients) {
      if (peer !== ws && peer.readyState === peer.OPEN) peer.send(payload)
    }
  })

  const drop = () => {
    room.clients.delete(ws)
    if (room.clients.size === 0) {
      // Keep the state around briefly so a refresh does not lose the room.
      setTimeout(() => {
        if (room.clients.size === 0) rooms.delete(name)
      }, 60_000)
    }
  }
  ws.on('close', drop)
  ws.on('error', drop)
})

server.listen(PORT, HOST, () => {
  console.log(`travl relay listening on ws://${HOST}:${PORT}`)
  console.log(`start the app with VITE_RELAY_URL=ws://${HOST}:${PORT}`)
})
