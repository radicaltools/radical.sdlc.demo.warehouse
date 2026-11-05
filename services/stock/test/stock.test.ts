import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'

function warehouse(stock: Record<string, number> = {}) {
  const app = buildServer()
  const post = (url: string, payload?: object, key?: string) => app.inject({ method: 'POST', url, payload, headers: key ? { 'idempotency-key': key } : {} })
  const stockOf = async (sku: string) => (await app.inject({ method: 'GET', url: `/stock/${sku}` })).json()
  const ready = Promise.all(Object.entries(stock).map(([sku, quantity]) => post('/stock/receipts', { sku, quantity })))
  return { app, post, stockOf, ready }
}

describe('stock', () => {
  it('holds stock for a request', async () => {
    const { post, stockOf, ready } = warehouse({ grinder: 10 })
    await ready
    const response = await post('/reservations', { lines: [{ sku: 'grinder', quantity: 3 }] }, 'A')
    expect(response.statusCode).toBe(201)
    expect(response.json().id).toEqual(expect.any(String))
    expect(response.json().status).toBe('held')
    expect(await stockOf('grinder')).toEqual({ sku: 'grinder', available: 7, onHand: 10, held: 3 })
  })
  it('holds all the lines or none', async () => {
    const { post, stockOf, ready } = warehouse({ mug: 2, grinder: 5 })
    await ready
    const response = await post('/reservations', { lines: [{ sku: 'mug', quantity: 3 }, { sku: 'grinder', quantity: 1 }] }, 'A')
    expect(response.statusCode).toBe(409)
    expect(response.json().short).toEqual([{ sku: 'mug', requested: 3, available: 2 }])
    expect((await stockOf('mug')).available).toBe(2)
    expect((await stockOf('grinder')).available).toBe(5)
  })
  it('holds once for a repeated key', async () => {
    const { post, stockOf, ready } = warehouse({ grinder: 10 })
    await ready
    const body = { lines: [{ sku: 'grinder', quantity: 3 }] }
    const first = await post('/reservations', body, 'A')
    const second = await post('/reservations', body, 'A')
    expect(second.json().id).toBe(first.json().id)
    expect((await stockOf('grinder')).held).toBe(3)
  })
  it('refuses a reservation without a key', async () => {
    const { post } = warehouse()
    expect((await post('/reservations', { lines: [{ sku: 'mug', quantity: 1 }] })).statusCode).toBe(400)
  })
  it('gives released goods back', async () => {
    const { post, stockOf, ready } = warehouse({ grinder: 10 })
    await ready
    const { id } = (await post('/reservations', { lines: [{ sku: 'grinder', quantity: 3 }] }, 'A')).json()
    expect((await stockOf('grinder')).available).toBe(7)
    expect((await post(`/reservations/${id}/release`)).json().status).toBe('released')
    expect((await stockOf('grinder')).available).toBe(10)
  })
  it('adds a delivery to what is on hand', async () => {
    const { post, stockOf, ready } = warehouse({ mug: 4 })
    await ready
    await post('/stock/receipts', { sku: 'mug', quantity: 6 })
    expect((await stockOf('mug')).onHand).toBe(10)
  })
  it('counts available as on hand minus held', async () => {
    const { post, stockOf, ready } = warehouse({ grinder: 10 })
    await ready
    await post('/reservations', { lines: [{ sku: 'grinder', quantity: 3 }] }, 'A')
    expect((await stockOf('grinder')).available).toBe(7)
  })
  it('answers 404 to an unknown SKU', async () => {
    const { app } = warehouse()
    expect((await app.inject({ method: 'GET', url: '/stock/never' })).statusCode).toBe(404)
  })
  it('lists nothing for a warehouse with no SKU', async () => {
    const { app } = warehouse()
    const response = await app.inject({ method: 'GET', url: '/stock' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
  })
  it('lists the whole stock sorted by SKU', async () => {
    const { post, app, ready } = warehouse()
    await ready
    await post('/stock/receipts', { sku: 'MUG-1', quantity: 4 })
    await post('/stock/receipts', { sku: 'GRN-1', quantity: 10 })
    await post('/reservations', { lines: [{ sku: 'GRN-1', quantity: 3 }] }, 'A')
    const response = await app.inject({ method: 'GET', url: '/stock' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([
      { sku: 'GRN-1', available: 7, onHand: 10, held: 3 },
      { sku: 'MUG-1', available: 4, onHand: 4, held: 0 },
    ])
  })
  it('lists a SKU with nothing on hand or held', async () => {
    const { post, app, ready } = warehouse()
    await ready
    await post('/stock/receipts', { sku: 'GRN-1', quantity: 3 })
    const { id } = (await post('/reservations', { lines: [{ sku: 'GRN-1', quantity: 3 }] }, 'A')).json()
    expect((await post(`/reservations/${id}/dispatch`)).json().status).toBe('dispatched')
    const response = await app.inject({ method: 'GET', url: '/stock' })
    expect(response.json()).toEqual([{ sku: 'GRN-1', available: 0, onHand: 0, held: 0 }])
  })
  it('refuses to release a dispatched reservation', async () => {
    const { post, stockOf, ready } = warehouse({ grinder: 10 })
    await ready
    const { id } = (await post('/reservations', { lines: [{ sku: 'grinder', quantity: 3 }] }, 'A')).json()
    await post(`/reservations/${id}/dispatch`)
    const before = await stockOf('grinder')
    expect((await post(`/reservations/${id}/release`)).statusCode).toBe(409)
    expect(await stockOf('grinder')).toEqual(before)
  })
  it('refuses a reused key with another body', async () => {
    const { post, stockOf, ready } = warehouse({ grinder: 10 })
    await ready
    await post('/reservations', { lines: [{ sku: 'grinder', quantity: 3 }] }, 'A')
    expect((await post('/reservations', { lines: [{ sku: 'grinder', quantity: 4 }] }, 'A')).statusCode).toBe(422)
    expect((await stockOf('grinder')).held).toBe(3)
  })
  it('puts returned goods back on the shelf', async () => {
    const { post, stockOf, ready } = warehouse({ grinder: 10 })
    await ready
    const { id } = (await post('/reservations', { lines: [{ sku: 'grinder', quantity: 3 }] }, 'A')).json()
    await post(`/reservations/${id}/dispatch`)
    expect((await stockOf('grinder')).onHand).toBe(7)
    const response = await post(`/reservations/${id}/return`, undefined, 'K')
    expect(response.statusCode).toBe(200)
    expect(response.json().status).toBe('returned')
    expect(await stockOf('grinder')).toEqual({ sku: 'grinder', available: 10, onHand: 10, held: 0 })
  })
  it('refuses a return of a reservation already returned', async () => {
    const { post, stockOf, ready } = warehouse({ grinder: 10 })
    await ready
    const { id } = (await post('/reservations', { lines: [{ sku: 'grinder', quantity: 3 }] }, 'A')).json()
    await post(`/reservations/${id}/dispatch`)
    await post(`/reservations/${id}/return`, undefined, 'R')
    const before = await stockOf('grinder')
    expect((await post(`/reservations/${id}/return`, undefined, 'L')).statusCode).toBe(409)
    expect(await stockOf('grinder')).toEqual(before)
    expect(before).toEqual({ sku: 'grinder', available: 10, onHand: 10, held: 0 })
  })
  it('refuses a return of a held reservation', async () => {
    const { post, stockOf, ready } = warehouse({ grinder: 10 })
    await ready
    const { id } = (await post('/reservations', { lines: [{ sku: 'grinder', quantity: 3 }] }, 'A')).json()
    const before = await stockOf('grinder')
    expect((await post(`/reservations/${id}/return`, undefined, 'K')).statusCode).toBe(409)
    expect(await stockOf('grinder')).toEqual(before)
    expect(before).toEqual({ sku: 'grinder', available: 7, onHand: 10, held: 3 })
  })
  it('refuses a return of a released reservation', async () => {
    const { post, stockOf, ready } = warehouse({ grinder: 10 })
    await ready
    const { id } = (await post('/reservations', { lines: [{ sku: 'grinder', quantity: 3 }] }, 'A')).json()
    await post(`/reservations/${id}/release`)
    expect((await post(`/reservations/${id}/return`, undefined, 'K')).statusCode).toBe(409)
    expect(await stockOf('grinder')).toEqual({ sku: 'grinder', available: 10, onHand: 10, held: 0 })
  })
  it('answers 404 to a return of an unknown reservation', async () => {
    const { post, stockOf, ready } = warehouse({ grinder: 10 })
    await ready
    expect((await post('/reservations/r-9/return', undefined, 'K')).statusCode).toBe(404)
    expect((await stockOf('grinder')).onHand).toBe(10)
  })
  it('refuses a return without a key', async () => {
    const { post, ready } = warehouse({ grinder: 10 })
    await ready
    const { id } = (await post('/reservations', { lines: [{ sku: 'grinder', quantity: 3 }] }, 'A')).json()
    await post(`/reservations/${id}/dispatch`)
    expect((await post(`/reservations/${id}/return`)).statusCode).toBe(400)
  })
  it('answers a repeated return the same and changes nothing', async () => {
    const { post, stockOf, ready } = warehouse({ grinder: 10 })
    await ready
    const { id } = (await post('/reservations', { lines: [{ sku: 'grinder', quantity: 3 }] }, 'A')).json()
    await post(`/reservations/${id}/dispatch`)
    const first = await post(`/reservations/${id}/return`, undefined, 'K')
    const second = await post(`/reservations/${id}/return`, undefined, 'K')
    expect(second.statusCode).toBe(200)
    expect(second.json()).toEqual(first.json())
    expect(await stockOf('grinder')).toEqual({ sku: 'grinder', available: 10, onHand: 10, held: 0 })
  })
  it('answers the same to two returns sent at once', async () => {
    const { post, stockOf, ready } = warehouse({ grinder: 10 })
    await ready
    const { id } = (await post('/reservations', { lines: [{ sku: 'grinder', quantity: 3 }] }, 'A')).json()
    await post(`/reservations/${id}/dispatch`)
    expect(await stockOf('grinder')).toEqual({ sku: 'grinder', available: 7, onHand: 7, held: 0 })
    const [first, second] = await Promise.all([
      post(`/reservations/${id}/return`, undefined, 'K'),
      post(`/reservations/${id}/return`, undefined, 'K'),
    ])
    expect(first.statusCode).toBe(200)
    expect(second.json()).toEqual(first.json())
    expect(await stockOf('grinder')).toEqual({ sku: 'grinder', available: 10, onHand: 10, held: 0 })
  })
  it('lists the held reservations holding a SKU by id', async () => {
    const { post, app, ready } = warehouse()
    await ready
    await post('/stock/receipts', { sku: 'GRN-1', quantity: 20 })
    await post('/stock/receipts', { sku: 'MUG-1', quantity: 4 })
    await post('/stock/receipts', { sku: 'FILL-1', quantity: 8 })
    await post('/reservations', { lines: [{ sku: 'MUG-1', quantity: 2 }] }, 'r1')
    await post('/reservations', { lines: [{ sku: 'GRN-1', quantity: 2 }] }, 'r2')
    for (let n = 3; n <= 9; n++) await post('/reservations', { lines: [{ sku: 'FILL-1', quantity: 1 }] }, `f${n}`)
    const tenth = (await post('/reservations', { lines: [{ sku: 'GRN-1', quantity: 3 }] }, 'r10')).json()
    expect(tenth.id).toBe('r-10')
    const response = await app.inject({ method: 'GET', url: '/stock/GRN-1/reservations' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([
      { id: 'r-2', quantity: 2 },
      { id: 'r-10', quantity: 3 },
    ])
  })
  it('lists an empty list for a known SKU with nothing held', async () => {
    const { app, ready } = warehouse({ 'GRN-1': 10 })
    await ready
    const response = await app.inject({ method: 'GET', url: '/stock/GRN-1/reservations' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
  })
  it('lists a reservation holding a SKU without changing any stock', async () => {
    const { app, post, stockOf, ready } = warehouse()
    await ready
    await post('/stock/receipts', { sku: 'GRN-1', quantity: 10 })
    await post('/reservations', { lines: [{ sku: 'GRN-1', quantity: 3 }] }, 'A')
    const response = await app.inject({ method: 'GET', url: '/stock/GRN-1/reservations' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([{ id: 'r-1', quantity: 3 }])
    expect(await stockOf('GRN-1')).toEqual({ sku: 'GRN-1', available: 7, onHand: 10, held: 3 })
  })
  it('does not list released or dispatched reservations', async () => {
    const { app, post, ready } = warehouse()
    await ready
    await post('/stock/receipts', { sku: 'GRN-1', quantity: 10 })
    const released = (await post('/reservations', { lines: [{ sku: 'GRN-1', quantity: 3 }] }, 'A')).json()
    const dispatched = (await post('/reservations', { lines: [{ sku: 'GRN-1', quantity: 1 }] }, 'B')).json()
    const held = (await post('/reservations', { lines: [{ sku: 'GRN-1', quantity: 2 }] }, 'C')).json()
    await post(`/reservations/${released.id}/release`)
    await post(`/reservations/${dispatched.id}/dispatch`)
    expect(held.id).toBe('r-3')
    const response = await app.inject({ method: 'GET', url: '/stock/GRN-1/reservations' })
    expect(response.json()).toEqual([{ id: 'r-3', quantity: 2 }])
  })
  it('answers 404 to the reservations of an unknown SKU', async () => {
    const { app } = warehouse()
    expect((await app.inject({ method: 'GET', url: '/stock/never/reservations' })).statusCode).toBe(404)
  })
  it('refuses a return key used for another reservation', async () => {
    const { app, post, stockOf, ready } = warehouse({ grinder: 10 })
    await ready
    const first = (await post('/reservations', { lines: [{ sku: 'grinder', quantity: 3 }] }, 'A')).json()
    await post(`/reservations/${first.id}/dispatch`)
    await post(`/reservations/${first.id}/return`, undefined, 'K')
    await post('/stock/receipts', { sku: 'grinder', quantity: 1 })
    const second = (await post('/reservations', { lines: [{ sku: 'grinder', quantity: 1 }] }, 'B')).json()
    await post(`/reservations/${second.id}/dispatch`)
    expect((await post(`/reservations/${second.id}/return`, undefined, 'K')).statusCode).toBe(422)
    expect((await app.inject({ method: 'GET', url: `/reservations/${second.id}` })).json().status).toBe('dispatched')
    expect(await stockOf('grinder')).toEqual({ sku: 'grinder', available: 10, onHand: 10, held: 0 })
  })
})
