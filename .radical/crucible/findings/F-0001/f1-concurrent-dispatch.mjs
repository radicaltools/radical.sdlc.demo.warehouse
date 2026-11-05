// Finding 1: two dispatches of one held reservation, sent at once with the same
// Idempotency-Key. The key must give one answer and one booking; the dispatch
// service checks "held" and the carrier booking across an await, so both calls
// can book. Exit 3 when the two answers carry different tracking numbers.

const STOCK = 'http://localhost:4602'
const DISPATCH = 'http://localhost:4702'
const stamp = Date.now()
const sku = `f1-sku-${stamp}`
const key = `f1-dispatch-${stamp}`

const json = (key, body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
  body: JSON.stringify(body),
})

async function main() {
  const receipt = await fetch(`${STOCK}/stock/receipts`, json(null, { sku, quantity: 5 }))
  if (receipt.status !== 201) {
    console.log(`receipt answered ${receipt.status}; cannot run`)
    process.exit(1)
  }
  const reserved = await fetch(`${STOCK}/reservations`, json(`res-${key}`, { lines: [{ sku, quantity: 1 }] }))
  if (reserved.status !== 201) {
    console.log(`reservation answered ${reserved.status}; cannot run`)
    process.exit(1)
  }
  const reservation = await reserved.json()
  console.log(`held ${reservation.id} (${reservation.status}) of ${sku}`)

  const send = () => fetch(`${DISPATCH}/dispatches`, json(key, { reservationId: reservation.id }))
  const answers = await Promise.all([send(), send()])
  const seen = []
  for (const answer of answers) seen.push({ status: answer.status, body: await answer.json() })
  for (const s of seen) console.log(`answer ${s.status}: ${JSON.stringify(s.body)}`)

  const tracking = new Set(seen.filter((s) => s.status === 201).map((s) => s.body.trackingNumber))
  const availability = await (await fetch(`${STOCK}/stock/${encodeURIComponent(sku)}`)).json()
  console.log(`after: onHand ${availability.onHand}, held ${availability.held}, available ${availability.available}`)

  if (tracking.size > 1) {
    console.log(`PROBLEM: one key, ${tracking.size} tracking numbers: ${[...tracking].join(', ')}`)
    process.exit(3)
  }
  console.log('one tracking number for the key')
  process.exit(0)
}

main().catch((error) => {
  console.log(`cannot reach the stack: ${error.message}`)
  process.exit(1)
})
