#!/usr/bin/env node
// Sensor oversell, for the fitness function No oversold stock (ADR Stock is never
// oversold): 200 reservations at once for 50 items, written as radical-metrics/1 to the
// metricsOut file radical sense run names. Runs with tsx.
import { writeFileSync } from 'node:fs'
import { buildServer } from '../../services/stock/src/server.ts'

const argument = process.argv.indexOf('--context')
if (argument < 0) throw new Error('no --context: run this sensor with radical sense run')
const { metricsOut } = JSON.parse(process.argv[argument + 1])

const app = buildServer()
await app.inject({ method: 'POST', url: '/stock/receipts', payload: { sku: 'mug', quantity: 50 } })
const answers = await Promise.all(Array.from({ length: 200 }, (_, i) =>
  app.inject({ method: 'POST', url: '/reservations', headers: { 'idempotency-key': `k-${i}` }, payload: { lines: [{ sku: 'mug', quantity: 1 }] } })))
const { held } = (await app.inject({ method: 'GET', url: '/stock/mug' })).json()
await app.close()

const oversold = Math.max(0, held - 50)
writeFileSync(metricsOut, JSON.stringify({
  format: 'radical-metrics', version: 1, source: 'oversell', at: new Date().toISOString(),
  measurements: [{ metric: 'stock.oversold_items', value: oversold, unit: 'items' }],
}, null, 2))
console.log(`${answers.filter((a) => a.statusCode === 201).length} of 200 reservations held, ${held} items held of 50, ${oversold} oversold.`)
