#!/usr/bin/env node
// Sensor smoke, for the fitness function Reservation reaches the carrier (ADR Services
// talk over HTTP): records a delivery, reserves and dispatches through the running stack.
// STOCK_URL and DISPATCH_URL say where it is (default: the ports of npm run stack and
// docker compose).
const stock = process.env.STOCK_URL ?? 'http://localhost:3011'
const dispatch = process.env.DISPATCH_URL ?? 'http://localhost:3012'

function fail(message) {
  console.error(message)
  process.exit(1)
}

const post = async (url, body, key) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    body: JSON.stringify(body),
  })
  if (!response.ok) fail(`POST ${url} answered ${response.status}: ${await response.text()}`)
  return response.json()
}

try {
  const sku = `smoke-${Date.now()}`
  await post(`${stock}/stock/receipts`, { sku, quantity: 5 })
  const reservation = await post(`${stock}/reservations`, { lines: [{ sku, quantity: 2 }] }, `${sku}-reserve`)
  const { trackingNumber } = await post(`${dispatch}/dispatches`, { reservationId: reservation.id }, `${sku}-dispatch`)
  if (!trackingNumber) fail('No tracking number.')
  const { onHand, held } = await (await fetch(`${stock}/stock/${sku}`)).json()
  if (onHand !== 3 || held !== 0) fail(`After the dispatch ${onHand} on hand and ${held} held, not 3 and 0.`)
  console.log(`Reservation ${reservation.id} reached the carrier: ${trackingNumber}.`)
} catch (error) {
  fail(`The stack does not answer: ${error.message}`)
}
