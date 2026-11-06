// The dispatch service: POST /dispatches, and GET /dispatches/{reservationId}.

import Fastify, { type FastifyInstance } from 'fastify'
import type { DispatchRequest } from '@warehouse/contracts'
import { CarrierDown, Dispatcher, NotDispatched, NotHeld, UnknownReservation, type Neighbours } from './dispatcher.js'

export function buildServer(neighbours: Neighbours): FastifyInstance {
  const app = Fastify()
  const dispatcher = new Dispatcher(neighbours)

  app.get('/health', async () => ({ ok: true }))

  app.get<{ Params: { reservationId: string } }>('/dispatches/:reservationId', async (request, reply) => {
    try {
      return reply.code(200).send(await dispatcher.status(request.params.reservationId))
    } catch (error) {
      if (error instanceof NotDispatched) return reply.code(404).send({ error: (error as Error).message })
      return reply.code(503).send({ error: 'The carrier status is not available' })
    }
  })

  app.post<{ Body: DispatchRequest }>('/dispatches', async (request, reply) => {
    const key = request.headers['idempotency-key']
    if (typeof key !== 'string' || !key) return reply.code(400).send({ error: 'A dispatch needs an Idempotency-Key header' })
    if (typeof request.body?.reservationId !== 'string') return reply.code(400).send({ error: 'A dispatch needs a reservationId' })
    try {
      return reply.code(201).send(await dispatcher.dispatch(key, request.body.reservationId, request.body.deliveryAddress))
    } catch (error) {
      if (error instanceof UnknownReservation) return reply.code(404).send({ error: error.message })
      if (error instanceof NotHeld) return reply.code(409).send({ error: error.message })
      if (error instanceof CarrierDown) return reply.code(503).send({ error: 'The carrier is not available' })
      return reply.code(503).send({ error: 'The stock service is not available' })
    }
  })
  return app
}
