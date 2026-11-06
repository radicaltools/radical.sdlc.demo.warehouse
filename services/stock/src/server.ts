// The stock service: reservations and what is on the shelves.

import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify'
import type { Receipt, ReserveRequest } from '@warehouse/contracts'
import { BadLine, ReusedKey, ShortStock, StockLedger, UnknownReservation, WrongMove } from './ledger.js'

export function buildServer(ledger = new StockLedger()): FastifyInstance {
  const app = Fastify()

  const answer = <T>(reply: FastifyReply, work: () => T, code = 200) => {
    try {
      return reply.code(code).send(work())
    } catch (error) {
      if (error instanceof ShortStock) return reply.code(409).send({ error: error.message, short: error.short })
      if (error instanceof BadLine) return reply.code(400).send({ error: error.message })
      if (error instanceof ReusedKey) return reply.code(422).send({ error: error.message })
      if (error instanceof UnknownReservation) return reply.code(404).send({ error: error.message })
      if (error instanceof WrongMove) return reply.code(409).send({ error: error.message })
      throw error
    }
  }

  app.get('/health', async () => ({ ok: true }))

  app.post<{ Body: ReserveRequest }>('/reservations', async (request, reply) => {
    const key = request.headers['idempotency-key']
    if (typeof key !== 'string' || !key) return reply.code(400).send({ error: 'A reservation needs an Idempotency-Key header' })
    return answer(reply, () => ledger.reserve(key, request.body?.lines), 201)
  })

  app.get<{ Params: { id: string } }>('/reservations/:id', async (request, reply) => {
    const reservation = ledger.get(request.params.id)
    return reservation ?? reply.code(404).send({ error: `No reservation ${request.params.id}` })
  })

  app.post<{ Params: { id: string } }>('/reservations/:id/release', async (request, reply) => {
    const key = request.headers['idempotency-key']
    if (typeof key !== 'string' || !key) return reply.code(400).send({ error: 'A release needs an Idempotency-Key header' })
    return answer(reply, () => ledger.release(key, request.params.id))
  })

  app.post<{ Params: { id: string } }>('/reservations/:id/dispatch', async (request, reply) =>
    answer(reply, () => ledger.dispatch(request.params.id)))

  app.post<{ Params: { id: string } }>('/reservations/:id/return', async (request, reply) => {
    const key = request.headers['idempotency-key']
    if (typeof key !== 'string' || !key) return reply.code(400).send({ error: 'A return needs an Idempotency-Key header' })
    return answer(reply, () => ledger.returnReservation(key, request.params.id))
  })

  app.get('/stock', async () => ledger.list())

  app.get<{ Params: { sku: string } }>('/stock/:sku', async (request, reply) => {
    const availability = ledger.availability(request.params.sku)
    return availability ?? reply.code(404).send({ error: `No SKU ${request.params.sku}` })
  })

  app.get<{ Params: { sku: string } }>('/stock/:sku/reservations', async (request, reply) => {
    const { sku } = request.params
    if (!ledger.availability(sku)) return reply.code(404).send({ error: `No SKU ${sku}` })
    return ledger.holding(sku)
  })

  app.post<{ Body: Receipt }>('/stock/receipts', async (request, reply) =>
    answer(reply, () => ledger.receive(request.body?.sku, request.body?.quantity), 201))

  return app
}
