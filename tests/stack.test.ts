// The warehouse's services on real ports, talking over HTTP, with a stand-in
// for the carrier.

import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { neighboursAt } from '../services/dispatch/src/neighbours.js'
import { buildServer as dispatch } from '../services/dispatch/src/server.js'
import { buildServer as stock } from '../services/stock/src/server.js'

let apps: FastifyInstance[] = []
let stockUrl = ''
let dispatchUrl = ''
let carrierUp = true
let carrierGivesDate = true
const parcels: unknown[] = []
const listen = (app: FastifyInstance) => app.listen({ host: '127.0.0.1', port: 0 })
const post = (url: string, body?: object, key?: string) => fetch(url, {
  method: 'POST',
  headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
})

beforeAll(async () => {
  const carrier = Fastify()
  carrier.post('/parcels', async (request, reply) => {
    if (!carrierUp) return reply.code(503).send({ error: 'closed' })
    parcels.push(request.body)
    return carrierGivesDate
      ? { trackingNumber: `T-${parcels.length}`, estimatedDeliveryDate: '2026-11-20' }
      : { trackingNumber: `T-${parcels.length}` }
  })
  const s = stock()
  stockUrl = await listen(s)
  const carrierUrl = await listen(carrier)
  const d = dispatch(neighboursAt(stockUrl, carrierUrl))
  dispatchUrl = await listen(d)
  apps = [carrier, s, d]
})
afterAll(() => Promise.all(apps.map((a) => a.close())))

describe('stack', () => {
  it('takes dispatched goods off the shelf', async () => {
    await post(`${stockUrl}/stock/receipts`, { sku: 'grinder', quantity: 10 })
    const { id } = await (await post(`${stockUrl}/reservations`, { lines: [{ sku: 'grinder', quantity: 3 }] }, 'A')).json() as { id: string }
    const dispatched = await post(`${dispatchUrl}/dispatches`, { reservationId: id }, 'A')
    expect(dispatched.status).toBe(201)
    expect(await dispatched.json()).toEqual({ reservationId: id, trackingNumber: 'T-1', estimatedDeliveryDate: '2026-11-20' })
    expect(parcels).toHaveLength(1)
    expect(await (await fetch(`${stockUrl}/stock/grinder`)).json()).toEqual({ sku: 'grinder', available: 7, onHand: 7, held: 0 })
  })
  it('takes dispatched goods off the shelf when the carrier gives no date', async () => {
    await post(`${stockUrl}/stock/receipts`, { sku: 'kettle', quantity: 10 })
    const { id } = await (await post(`${stockUrl}/reservations`, { lines: [{ sku: 'kettle', quantity: 3 }] }, 'C')).json() as { id: string }
    const booked = parcels.length
    carrierGivesDate = false
    try {
      const dispatched = await post(`${dispatchUrl}/dispatches`, { reservationId: id }, 'C')
      expect(dispatched.status).toBe(201)
      expect(await dispatched.json()).toEqual({ reservationId: id, trackingNumber: `T-${booked + 1}`, estimatedDeliveryDate: null })
    } finally {
      carrierGivesDate = true
    }
    expect(parcels).toHaveLength(booked + 1)
    expect(await (await fetch(`${stockUrl}/stock/kettle`)).json()).toEqual({ sku: 'kettle', available: 7, onHand: 7, held: 0 })
    expect((await (await fetch(`${stockUrl}/reservations/${id}`)).json() as { status: string }).status).toBe('dispatched')
  })
  it('keeps a reservation held while the carrier is down', async () => {
    await post(`${stockUrl}/stock/receipts`, { sku: 'mug', quantity: 2 })
    const { id } = await (await post(`${stockUrl}/reservations`, { lines: [{ sku: 'mug', quantity: 1 }] }, 'B')).json() as { id: string }
    carrierUp = false
    expect((await post(`${dispatchUrl}/dispatches`, { reservationId: id }, 'B')).status).toBe(503)
    carrierUp = true
    expect((await (await fetch(`${stockUrl}/reservations/${id}`)).json() as { status: string }).status).toBe('held')
  })
})
