// The rules of the warehouse over random sequences of requests (ADR Rules hold under
// any sequence), written with Radical Crucible's engine and run by radical fuzz: on
// fixed seeds with every change, on a random seed and 2000 runs at night. A failure
// shrinks to the shortest sequence that breaks the rule.
//
// KNOWN lists the open findings that break a rule. A run that hits one ends quietly, so
// the Gate stays green until the fix: remove the entry with the fix.

import { fc, loadFindings, type FuzzSuite, type Known } from '@radicaltools/crucible'
import { fuzzSuite } from '@radicaltools/crucible/vitest'
import type { Reservation, ReservationLine } from '@warehouse/contracts'
import { buildServer } from '../../services/stock/src/server.js'

const SKUS = ['mug', 'beans', 'grinder']

type Action =
  | { a: 'receive'; sku: string; quantity: number }
  | { a: 'reserve'; key: string; lines: ReservationLine[] }
  | { a: 'release' | 'dispatch' | 'read'; which: number }

const sku = fc.constantFrom(...SKUS)
const quantity = fc.oneof(fc.integer({ min: 1, max: 9 }), fc.constantFrom(0, -1, 1.5, undefined as unknown as number))
const actions: fc.Arbitrary<Action> = fc.oneof(
  { weight: 2, arbitrary: fc.record({ a: fc.constant('receive' as const), sku, quantity }) },
  { weight: 3, arbitrary: fc.record({ a: fc.constant('reserve' as const), key: fc.constantFrom('A', 'B', 'C', 'D', 'E', 'F'), lines: fc.array(fc.record({ sku, quantity }), { maxLength: 3 }) }) },
  { weight: 2, arbitrary: fc.record({ a: fc.constantFrom('release' as const, 'dispatch' as const, 'read' as const), which: fc.integer({ min: -1, max: 5 }) }) },
)

const KNOWN: Known<Action>[] = []

interface Run {
  app: ReturnType<typeof buildServer>
  reservations: Reservation[]
  byKey: Map<string, string>
  onHand: Map<string, number>
}

const suite: FuzzSuite<Action, null, Run> = {
  name: 'warehouse',
  file: 'tests/fuzz/warehouse.fuzz.test.ts',
  rules: ['noServerError', 'neverOversold', 'stockAddsUp', 'lifecycleHolds', 'keyHoldsOnce'],
  actions,
  worlds: { warehouse: { seed: 20261103, runs: 40, maxLength: 14 } },
  known: KNOWN,
  prepare: () => null,
  start: () => ({ app: buildServer(), reservations: [], byKey: new Map(), onHand: new Map() }),
  async step(run, action, ctx) {
    ctx.actions.push(action)
    const noServerError = (status: number, what: string) => {
      if (status >= 500) ctx.fail({ rule: 'noServerError', detail: `${what} answered ${status}` })
    }
    if (action.a === 'receive') {
      const response = await run.app.inject({ method: 'POST', url: '/stock/receipts', payload: { sku: action.sku, quantity: action.quantity } })
      ctx.trace.push(`receive: ${response.statusCode}`)
      noServerError(response.statusCode, 'a delivery')
      if (response.statusCode === 201) run.onHand.set(action.sku, (run.onHand.get(action.sku) ?? 0) + action.quantity)
    } else if (action.a === 'reserve') {
      const response = await run.app.inject({ method: 'POST', url: '/reservations', headers: { 'idempotency-key': action.key }, payload: { lines: action.lines } })
      ctx.trace.push(`reserve ${action.key}: ${response.statusCode}`)
      noServerError(response.statusCode, 'a reservation')
      if (response.statusCode === 201) {
        const reservation = response.json() as Reservation
        const first = run.byKey.get(action.key)
        if (first && first !== reservation.id) ctx.fail({ rule: 'keyHoldsOnce', detail: `key ${action.key} answered ${reservation.id}, first ${first}` })
        if (!first) {
          run.byKey.set(action.key, reservation.id)
          run.reservations.push(reservation)
        }
      }
    } else {
      const reservation = action.which < 0 ? undefined : run.reservations[action.which % run.reservations.length]
      if (action.which >= 0 && !reservation) {
        ctx.trace.push(`${action.a}: no reservation yet`)
        return
      }
      const id = reservation?.id ?? 'r-999'
      if (action.a === 'read') {
        const response = await run.app.inject({ method: 'GET', url: `/reservations/${id}` })
        ctx.trace.push(`read ${id}: ${response.statusCode}`)
        noServerError(response.statusCode, `reading ${id}`)
      } else {
        const response = await run.app.inject({ method: 'POST', url: `/reservations/${id}/${action.a}` })
        ctx.trace.push(`${action.a} ${id}: ${response.statusCode}`)
        noServerError(response.statusCode, `${action.a} of ${id}`)
        if (reservation) {
          const to = action.a === 'release' ? 'released' : 'dispatched'
          const allowed = reservation.status === 'held' || reservation.status === to
          if (allowed !== (response.statusCode === 200)) ctx.fail({ rule: 'lifecycleHolds', detail: `${action.a} of a ${reservation.status} reservation answered ${response.statusCode}` })
          if (allowed && reservation.status === 'held') {
            reservation.status = to
            if (to === 'dispatched') for (const line of reservation.lines) run.onHand.set(line.sku, run.onHand.get(line.sku)! - line.quantity)
          }
        }
      }
    }
    for (const name of SKUS) {
      const response = await run.app.inject({ method: 'GET', url: `/stock/${name}` })
      if (response.statusCode !== 200) continue
      const { available, onHand, held } = response.json()
      if (available < 0) ctx.fail({ rule: 'neverOversold', detail: `${name}: ${available} available` })
      const expectedHeld = run.reservations.filter((r) => r.status === 'held').flatMap((r) => r.lines).filter((l) => l.sku === name).reduce((sum, l) => sum + l.quantity, 0)
      if (held !== expectedHeld || onHand !== (run.onHand.get(name) ?? 0) || available !== onHand - held) {
        ctx.fail({ rule: 'stockAddsUp', detail: `${name}: on hand ${onHand}, held ${held}, available ${available}; expected on hand ${run.onHand.get(name) ?? 0}, held ${expectedHeld}` })
      }
    }
  },
  async end(run) {
    await run.app.close()
  },
  isNoOp: (resolved) => resolved.includes('no reservation yet'),
}

fuzzSuite(suite, { title: 'warehouse rules', findings: await loadFindings('.radical/crucible/findings') })
