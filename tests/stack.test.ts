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
let carrierRefuses = false
let carrierGivesDate = true
let carrierRefusesBadCountry = false
let carrierTracking: string | undefined
const parcels: unknown[] = []
/** Every body the carrier was sent, refused or not. */
const attempts: unknown[] = []
const listen = (app: FastifyInstance) => app.listen({ host: '127.0.0.1', port: 0 })
const post = (url: string, body?: object, key?: string) => fetch(url, {
  method: 'POST',
  headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
})

beforeAll(async () => {
  const carrier = Fastify()
  carrier.post('/parcels', async (request, reply) => {
    attempts.push(request.body)
    if (!carrierUp) return reply.code(503).send({ error: 'closed' })
    if (carrierRefuses) return reply.code(422).send({ error: 'refused' })
    const country = (request.body as { deliveryAddress?: { country?: unknown } }).deliveryAddress?.country
    if (carrierRefusesBadCountry && country !== undefined && !(typeof country === 'string' && /^[A-Z]{2}$/.test(country))) {
      return reply.code(422).send({ error: 'The country is not a two-letter code' })
    }
    parcels.push(request.body)
    const trackingNumber = carrierTracking ?? `T-${parcels.length}`
    return carrierGivesDate
      ? { trackingNumber, estimatedDeliveryDate: '2026-11-20' }
      : { trackingNumber }
  })
  const s = stock()
  stockUrl = await listen(s)
  const carrierUrl = await listen(carrier)
  const d = dispatch(neighboursAt(stockUrl, carrierUrl))
  dispatchUrl = await listen(d)
  apps = [carrier, s, d]
})
afterAll(() => Promise.all(apps.map((a) => a.close())))

const address = { street: 'Dluga 1', city: 'Warsaw', postalCode: '00-001', country: 'PL' }

describe('stack', () => {
  it('takes dispatched goods off the shelf', async () => {
    await post(`${stockUrl}/stock/receipts`, { sku: 'grinder', quantity: 10 })
    const { id } = await (await post(`${stockUrl}/reservations`, { lines: [{ sku: 'grinder', quantity: 3 }] }, 'A')).json() as { id: string }
    const dispatched = await post(`${dispatchUrl}/dispatches`, { reservationId: id, deliveryAddress: address }, 'A')
    expect(dispatched.status).toBe(201)
    expect(await dispatched.json()).toEqual({ reservationId: id, trackingNumber: 'T-1', estimatedDeliveryDate: '2026-11-20' })
    expect(parcels).toHaveLength(1)
    expect(parcels[0]).toEqual({ reference: id, lines: [{ sku: 'grinder', quantity: 3 }], deliveryAddress: address })
    expect(await (await fetch(`${stockUrl}/stock/grinder`)).json()).toEqual({ sku: 'grinder', available: 7, onHand: 7, held: 0 })
  })
  it('books as before for a dispatch without a delivery address', async () => {
    await post(`${stockUrl}/stock/receipts`, { sku: 'lamp', quantity: 5 })
    const { id } = await (await post(`${stockUrl}/reservations`, { lines: [{ sku: 'lamp', quantity: 1 }] }, 'D')).json() as { id: string }
    const booked = parcels.length
    carrierGivesDate = false
    carrierTracking = 'TRK-1'
    try {
      const dispatched = await post(`${dispatchUrl}/dispatches`, { reservationId: id }, 'D')
      expect(dispatched.status).toBe(201)
      expect(await dispatched.json()).toEqual({ reservationId: id, trackingNumber: 'TRK-1', estimatedDeliveryDate: null })
    } finally {
      carrierGivesDate = true
      carrierTracking = undefined
    }
    expect(parcels).toHaveLength(booked + 1)
    expect(parcels[booked]).toEqual({ reference: id, lines: [{ sku: 'lamp', quantity: 1 }] })
    expect(await (await fetch(`${stockUrl}/stock/lamp`)).json()).toEqual({ sku: 'lamp', available: 4, onHand: 4, held: 0 })
    expect((await (await fetch(`${stockUrl}/reservations/${id}`)).json() as { status: string }).status).toBe('dispatched')
  })
  it('takes dispatched goods off the shelf when the carrier gives no date', async () => {
    await post(`${stockUrl}/stock/receipts`, { sku: 'kettle', quantity: 10 })
    const { id } = await (await post(`${stockUrl}/reservations`, { lines: [{ sku: 'kettle', quantity: 3 }] }, 'C')).json() as { id: string }
    const booked = parcels.length
    carrierGivesDate = false
    try {
      const dispatched = await post(`${dispatchUrl}/dispatches`, { reservationId: id, deliveryAddress: address }, 'C')
      expect(dispatched.status).toBe(201)
      expect(await dispatched.json()).toEqual({ reservationId: id, trackingNumber: `T-${booked + 1}`, estimatedDeliveryDate: null })
    } finally {
      carrierGivesDate = true
    }
    expect(parcels).toHaveLength(booked + 1)
    expect(parcels[booked]).toMatchObject({ deliveryAddress: address })
    expect(await (await fetch(`${stockUrl}/stock/kettle`)).json()).toEqual({ sku: 'kettle', available: 7, onHand: 7, held: 0 })
    expect((await (await fetch(`${stockUrl}/reservations/${id}`)).json() as { status: string }).status).toBe('dispatched')
  })
  it('keeps a reservation held while the carrier is down', async () => {
    await post(`${stockUrl}/stock/receipts`, { sku: 'mug', quantity: 2 })
    const { id } = await (await post(`${stockUrl}/reservations`, { lines: [{ sku: 'mug', quantity: 1 }] }, 'B')).json() as { id: string }
    carrierUp = false
    expect((await post(`${dispatchUrl}/dispatches`, { reservationId: id, deliveryAddress: address }, 'B')).status).toBe(503)
    carrierUp = true
    expect((await (await fetch(`${stockUrl}/reservations/${id}`)).json() as { status: string }).status).toBe('held')
  })
  it('keeps a reservation held when the carrier refuses the booking', async () => {
    await post(`${stockUrl}/stock/receipts`, { sku: 'burr', quantity: 5 })
    const { id } = await (await post(`${stockUrl}/reservations`, { lines: [{ sku: 'burr', quantity: 1 }] }, 'E')).json() as { id: string }
    const booked = parcels.length
    carrierRefuses = true
    try {
      expect((await post(`${dispatchUrl}/dispatches`, { reservationId: id, deliveryAddress: address }, 'E')).status).toBe(503)
    } finally {
      carrierRefuses = false
    }
    expect(parcels).toHaveLength(booked)
    expect(await (await fetch(`${stockUrl}/stock/burr`)).json()).toEqual({ sku: 'burr', available: 4, onHand: 5, held: 1 })
    expect((await (await fetch(`${stockUrl}/reservations/${id}`)).json() as { status: string }).status).toBe('held')
  })
  it('forwards an address the Warehouse does not check, and keeps the reservation held', async () => {
    await post(`${stockUrl}/stock/receipts`, { sku: 'grinder-2', quantity: 5 })
    const { id } = await (await post(`${stockUrl}/reservations`, { lines: [{ sku: 'grinder-2', quantity: 1 }] }, 'F')).json() as { id: string }
    const booked = parcels.length
    const attempted = attempts.length
    const unchecked = { ...address, country: 'POL' }
    carrierRefusesBadCountry = true
    try {
      expect((await post(`${dispatchUrl}/dispatches`, { reservationId: id, deliveryAddress: unchecked }, 'F')).status).toBe(503)
    } finally {
      carrierRefusesBadCountry = false
    }
    expect(attempts).toHaveLength(attempted + 1)
    expect(attempts[attempted]).toEqual({ reference: id, lines: [{ sku: 'grinder-2', quantity: 1 }], deliveryAddress: unchecked })
    expect(parcels).toHaveLength(booked)
    expect(await (await fetch(`${stockUrl}/stock/grinder-2`)).json()).toEqual({ sku: 'grinder-2', available: 4, onHand: 5, held: 1 })
    expect((await (await fetch(`${stockUrl}/reservations/${id}`)).json() as { status: string }).status).toBe('held')
  })
})
