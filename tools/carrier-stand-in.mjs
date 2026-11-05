#!/usr/bin/env node
// Stands in for the carrier on a staging or a laptop: books every parcel. The real
// one is another company's.
import { createServer } from 'node:http'

let parcels = 0
createServer((request, response) => {
  const answer = (code, body) => {
    response.writeHead(code, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  }
  if (request.method === 'GET' && request.url === '/health') return answer(200, { ok: true })
  if (request.method === 'GET' && /^\/parcels\/[^/]+$/.test(request.url)) return answer(200, { status: 'in-transit' })
  if (request.method === 'POST' && request.url === '/parcels') {
    request.resume()
    return request.on('end', () => answer(201, { trackingNumber: `T-${++parcels}` }))
  }
  return answer(404, { error: 'No such route' })
}).listen(Number(process.env.PORT ?? 3013), '0.0.0.0')
