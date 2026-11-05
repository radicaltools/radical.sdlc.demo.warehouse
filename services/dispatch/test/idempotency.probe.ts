// The named writes of the dispatch service, for the sensor idempotency (ADR Retried
// writes change nothing): each is sent twice, and the second must change nothing. The
// neighbours take a moment to answer, as over a network: two writes sent at the same
// time meet only while one of them waits.

import { buildServer } from '../src/server.js'

const aMoment = () => new Promise<void>((resolve) => setTimeout(resolve, 5))

export const probes = [{
  name: 'POST /dispatches',
  async prepare() {
    let booked = 0
    const app = buildServer({
      reservation: async (id) => { await aMoment(); return { id, lines: [{ sku: 'mug', quantity: 1 }], status: 'held' } },
      markDispatched: aMoment,
      book: async () => { await aMoment(); return { trackingNumber: `T-${++booked}`, estimatedDeliveryDate: null } },
      parcelStatus: async () => 'in-transit',
    })
    return {
      app,
      request: { method: 'POST' as const, url: '/dispatches', headers: { 'idempotency-key': 'probe' }, payload: { reservationId: 'r-1' } },
      state: async () => ({ booked }),
    }
  },
}]
