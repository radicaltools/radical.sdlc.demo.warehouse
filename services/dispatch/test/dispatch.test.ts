import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import type { Booking, ParcelStatus, Reservation } from '@warehouse/contracts'
import { CarrierDown, type Neighbours } from '../src/dispatcher.js'
import { neighboursAt } from '../src/neighbours.js'
import { buildServer } from '../src/server.js'

const held: Reservation = { id: 'r-1', lines: [{ sku: 'grinder', quantity: 3 }], status: 'held' }
const address = { street: 'Dluga 1', city: 'Warsaw', postalCode: '00-001', country: 'PL' }

function dispatch(overrides: Partial<Neighbours> = {}, reservation: Reservation | undefined = held) {
  const calls = { booked: 0, marked: [] as string[], addresses: [] as unknown[] }
  const app = buildServer({
    reservation: async () => reservation,
    markDispatched: async (id) => { calls.marked.push(id) },
    book: async (_reservation, deliveryAddress) => { calls.booked++; calls.addresses.push(deliveryAddress); return { trackingNumber: 'T-1', estimatedDeliveryDate: '2026-11-20' } },
    parcelStatus: async () => ({ status: 'in-transit', deliveredAt: null }),
    ...overrides,
  })
  const post = (key = 'A') => app.inject({ method: 'POST', url: '/dispatches', payload: { reservationId: 'r-1', deliveryAddress: address }, headers: { 'idempotency-key': key } })
  return { calls, post }
}

describe('dispatch', () => {
  it('books the carrier for a held reservation', async () => {
    const { calls, post } = dispatch()
    const response = await post()
    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual({ reservationId: 'r-1', trackingNumber: 'T-1', estimatedDeliveryDate: '2026-11-20' })
    expect(calls.booked).toBe(1)
    expect(calls.addresses).toEqual([address])
    expect(calls.marked).toEqual(['r-1'])
  })
  it('leaves the reservation held while the carrier is down', async () => {
    const { calls, post } = dispatch({ book: async () => { throw new CarrierDown('no answer') } })
    expect((await post()).statusCode).toBe(503)
    expect(calls.marked).toEqual([])
  })
  it('refuses a reservation that is not held', async () => {
    const { calls, post } = dispatch({}, { ...held, status: 'released' })
    expect((await post()).statusCode).toBe(409)
    expect(calls.booked).toBe(0)
  })
  it('answers 404 to an unknown reservation', async () => {
    const { post } = dispatch({ reservation: async () => undefined })
    expect((await post()).statusCode).toBe(404)
  })
  it('books once for a repeated key', async () => {
    const { calls, post } = dispatch()
    const first = await post()
    expect((await post()).json()).toEqual(first.json())
    expect(calls.booked).toBe(1)
  })
  it('books once for two dispatches sent at the same time', async () => {
    const aMoment = () => new Promise<void>((resolve) => setTimeout(resolve, 5))
    const calls = { booked: 0 }
    const app = buildServer({
      reservation: async (id) => { await aMoment(); return { ...held, id } },
      markDispatched: aMoment,
      book: async (): Promise<Booking> => { await aMoment(); calls.booked++; return { trackingNumber: `T-${calls.booked}`, estimatedDeliveryDate: null } },
      parcelStatus: async () => ({ status: 'in-transit', deliveredAt: null }),
    })
    const post = () => app.inject({ method: 'POST', url: '/dispatches', payload: { reservationId: 'r-1', deliveryAddress: address }, headers: { 'idempotency-key': 'K' } })
    const [first, second] = await Promise.all([post(), post()])
    expect(first.statusCode).toBe(201)
    expect(second.json()).toEqual(first.json())
    expect(calls.booked).toBe(1)
  })
  it('does not book again when stock failed after the booking', async () => {
    let failing = true
    const { calls, post } = dispatch({ markDispatched: async () => { if (failing) throw new Error('no answer') } })
    expect((await post()).statusCode).toBe(503)
    failing = false
    expect((await post()).json().trackingNumber).toBe('T-1')
    expect(calls.booked).toBe(1)
  })
})

/** Stock as the neighbours see it. The carrier books each parcel with `tracking` and `estimated` (a date, or null), and what was asked of the carrier is kept. */
function stockWith(tracking: string, estimated: string | null, ...reservations: Reservation[]) {
  const stored = new Map(reservations.map((r) => [r.id, { ...r }]))
  const calls = { booked: 0, asked: [] as string[] }
  const neighbours: Neighbours = {
    reservation: async (id) => stored.get(id),
    markDispatched: async (id) => {
      const reservation = stored.get(id)
      if (reservation) reservation.status = 'dispatched'
    },
    book: async () => { calls.booked++; return { trackingNumber: tracking, estimatedDeliveryDate: estimated } },
    parcelStatus: async (trackingNumber) => { calls.asked.push(trackingNumber); return { status: 'in-transit', deliveredAt: null } },
  }
  return { stored, calls, neighbours }
}

/** A carrier on a real port: it books, and answers the status of TRK-1 with `status`, or not at all while `answering` is false. */
async function carrierAt(status: string) {
  const carrier = { answering: true, status }
  const server = createServer((request, response) => {
    if (!carrier.answering) return request.socket.destroy()
    response.setHeader('content-type', 'application/json')
    if (request.method === 'POST' && request.url === '/parcels') {
      request.resume()
      return request.on('end', () => response.end(JSON.stringify({ trackingNumber: 'TRK-1' })))
    }
    if (request.method === 'GET' && request.url === '/parcels/TRK-1') return response.end(JSON.stringify({ status: carrier.status }))
    response.statusCode = 404
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    carrier,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() }),
  }
}

describe('carrier status', () => {
  const dispatchR1 = (app: FastifyInstance, deliveryAddress?: object) => app.inject({
    method: 'POST', url: '/dispatches', payload: { reservationId: 'r-1', deliveryAddress }, headers: { 'idempotency-key': 'A' },
  })
  const statusOf = (app: FastifyInstance, reservationId: string) => app.inject({ method: 'GET', url: `/dispatches/${reservationId}` })

  it('answers the carrier status of a dispatched reservation', async () => {
    const { stored, calls, neighbours } = stockWith('TRK-1', '2026-11-20', held)
    const app = buildServer(neighbours)
    await dispatchR1(app)
    const booked = calls.booked
    const response = await statusOf(app, 'r-1')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ reservationId: 'r-1', trackingNumber: 'TRK-1', estimatedDeliveryDate: '2026-11-20', status: 'in-transit', deliveredAt: null })
    expect(calls.booked).toBe(booked)
    expect(stored.get('r-1')?.status).toBe('dispatched')
  })
  it('answers delivered when the carrier reports the parcel delivered', async () => {
    const { stored, calls, neighbours } = stockWith('TRK-2', '2026-11-20', held)
    const app = buildServer({
      ...neighbours,
      parcelStatus: async (trackingNumber): Promise<ParcelStatus> => { calls.asked.push(trackingNumber); return { status: 'delivered', deliveredAt: '2026-11-21T10:30:00Z' } },
    })
    await dispatchR1(app)
    const response = await statusOf(app, 'r-1')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ reservationId: 'r-1', trackingNumber: 'TRK-2', estimatedDeliveryDate: '2026-11-20', status: 'delivered', deliveredAt: '2026-11-21T10:30:00Z' })
    expect(calls.asked).toEqual(['TRK-2'])
    expect(stored.get('r-1')?.status).toBe('dispatched')
  })
  it('answers delivered without a time when the carrier gives none, and asks the carrier only', async () => {
    const { stored, calls, neighbours } = stockWith('TRK-3', '2026-11-20', { ...held, id: 'r-2' })
    const app = buildServer({
      ...neighbours,
      parcelStatus: async (trackingNumber): Promise<ParcelStatus> => { calls.asked.push(trackingNumber); return { status: 'delivered', deliveredAt: null } },
    })
    const dispatched = await app.inject({ method: 'POST', url: '/dispatches', payload: { reservationId: 'r-2' }, headers: { 'idempotency-key': 'B' } })
    expect(dispatched.statusCode).toBe(201)
    const response = await statusOf(app, 'r-2')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ reservationId: 'r-2', trackingNumber: 'TRK-3', estimatedDeliveryDate: '2026-11-20', status: 'delivered', deliveredAt: null })
    expect(calls.asked).toEqual(['TRK-3'])
    expect(stored.get('r-2')?.status).toBe('dispatched')
  })
  it('keeps the estimated date the carrier gave, and answers it again', async () => {
    const { calls, neighbours } = stockWith('TRK-1', '2026-11-20', held)
    const app = buildServer(neighbours)
    const dispatched = await dispatchR1(app, address)
    expect(dispatched.statusCode).toBe(201)
    expect(dispatched.json()).toEqual({ reservationId: 'r-1', trackingNumber: 'TRK-1', estimatedDeliveryDate: '2026-11-20' })
    const response = await statusOf(app, 'r-1')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ trackingNumber: 'TRK-1', estimatedDeliveryDate: '2026-11-20' })
    expect(calls.booked).toBe(1)
  })
  it('answers null when the carrier gave no date, and the status without one', async () => {
    const { stored, calls, neighbours } = stockWith('TRK-1', null, held)
    const app = buildServer(neighbours)
    const dispatched = await dispatchR1(app, address)
    expect(dispatched.statusCode).toBe(201)
    expect(dispatched.json()).toEqual({ reservationId: 'r-1', trackingNumber: 'TRK-1', estimatedDeliveryDate: null })
    const response = await statusOf(app, 'r-1')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ reservationId: 'r-1', trackingNumber: 'TRK-1', estimatedDeliveryDate: null, status: 'in-transit', deliveredAt: null })
    expect(calls.booked).toBe(1)
    expect(stored.get('r-1')?.status).toBe('dispatched')
  })
  it('answers 404 to a reservation that is held and not dispatched', async () => {
    const { stored, calls, neighbours } = stockWith('TRK-1', '2026-11-20', { ...held, id: 'r-2', status: 'held' })
    const app = buildServer(neighbours)
    expect((await statusOf(app, 'r-2')).statusCode).toBe(404)
    expect(stored.get('r-2')?.status).toBe('held')
    expect(calls.asked).toEqual([])
  })
  it('answers 404 to an unknown reservation', async () => {
    const { calls, neighbours } = stockWith('TRK-1', '2026-11-20', held)
    const app = buildServer(neighbours)
    expect((await statusOf(app, 'r-9')).statusCode).toBe(404)
    expect(calls.asked).toEqual([])
  })
  it('answers 503 for a dispatched reservation after a restart, without asking the carrier', async () => {
    const { stored, calls, neighbours } = stockWith('TRK-1', '2026-11-20', { ...held, status: 'dispatched' })
    const app = buildServer(neighbours)
    expect((await statusOf(app, 'r-1')).statusCode).toBe(503)
    expect(calls.asked).toEqual([])
    expect(stored.get('r-1')?.status).toBe('dispatched')
  })
  it('answers out-for-delivery when the carrier reports the parcel out for delivery', async () => {
    const carrier = await carrierAt('out-for-delivery')
    try {
      const { stored, calls, neighbours } = stockWith('TRK-1', '2026-11-20', held)
      const app = buildServer({ ...neighbours, parcelStatus: neighboursAt('http://127.0.0.1:1', carrier.url).parcelStatus })
      await dispatchR1(app)
      const booked = calls.booked
      const response = await statusOf(app, 'r-1')
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ reservationId: 'r-1', trackingNumber: 'TRK-1', estimatedDeliveryDate: '2026-11-20', status: 'out-for-delivery', deliveredAt: null })
      expect(calls.booked).toBe(booked)
      expect(stored.get('r-1')?.status).toBe('dispatched')
    } finally {
      await carrier.close()
    }
  })
  it('answers 503 when the carrier answers a status it does not know', async () => {
    const carrier = await carrierAt('archived')
    try {
      const { stored, neighbours } = stockWith('TRK-1', '2026-11-20', held)
      const app = buildServer({ ...neighbours, parcelStatus: neighboursAt('http://127.0.0.1:1', carrier.url).parcelStatus })
      await dispatchR1(app)
      expect((await statusOf(app, 'r-1')).statusCode).toBe(503)
      expect(stored.get('r-1')?.status).toBe('dispatched')
    } finally {
      await carrier.close()
    }
  })
  it('answers 503 while the carrier does not answer', async () => {
    const carrier = await carrierAt('in-transit')
    try {
      const { stored, neighbours } = stockWith('TRK-1', '2026-11-20', held)
      const app = buildServer({ ...neighbours, parcelStatus: neighboursAt('http://127.0.0.1:1', carrier.url).parcelStatus })
      await dispatchR1(app)
      carrier.carrier.answering = false
      expect((await statusOf(app, 'r-1')).statusCode).toBe(503)
      expect(stored.get('r-1')?.status).toBe('dispatched')
    } finally {
      await carrier.close()
    }
  })
})
