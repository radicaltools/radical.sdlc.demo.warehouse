// The named writes of the stock service, for the sensor idempotency (ADR Retried
// writes change nothing): each is sent twice, and the second must change nothing.

import { buildServer } from '../src/server.js'

export const probes = [{
  name: 'POST /reservations',
  async prepare() {
    const app = buildServer()
    await app.inject({ method: 'POST', url: '/stock/receipts', payload: { sku: 'mug', quantity: 5 } })
    return {
      app,
      request: { method: 'POST' as const, url: '/reservations', headers: { 'idempotency-key': 'probe' }, payload: { lines: [{ sku: 'mug', quantity: 2 }] } },
      state: async () => (await app.inject({ method: 'GET', url: '/stock/mug' })).json(),
    }
  },
}, {
  name: 'POST /reservations/:id/release',
  async prepare() {
    const app = buildServer()
    await app.inject({ method: 'POST', url: '/stock/receipts', payload: { sku: 'mug', quantity: 5 } })
    const { id } = (await app.inject({ method: 'POST', url: '/reservations', headers: { 'idempotency-key': 'probe' }, payload: { lines: [{ sku: 'mug', quantity: 2 }] } })).json()
    return {
      app,
      request: { method: 'POST' as const, url: `/reservations/${id}/release`, headers: { 'idempotency-key': 'probe-release' } },
      state: async () => (await app.inject({ method: 'GET', url: '/stock/mug' })).json(),
    }
  },
}]
