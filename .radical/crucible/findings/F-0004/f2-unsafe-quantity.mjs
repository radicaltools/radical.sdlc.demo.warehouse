// F: a delivery above 2^53-1 is accepted, and a later delivery is added to a rounded number.
// Exits 3 when the problem is there, 0 when it is not.
const base = 'http://localhost:4601'
const sku = `SAFE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

const receive = async (quantity) => {
  const r = await fetch(`${base}/stock/receipts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sku, quantity }),
  })
  return { status: r.status, text: await r.text() }
}

const a = await receive(Number.MAX_SAFE_INTEGER)
const b = await receive(2)
console.log('receipt 2^53-1 ->', a.status, a.text)
console.log('receipt 2      ->', b.status, b.text)

// The true on hand is 2^53-1 + 2 = 9007199254740993. Read the digits from the text: JSON.parse would round them too.
const onHand = b.text.match(/"onHand":(\d+)/)?.[1]
const expected = BigInt(Number.MAX_SAFE_INTEGER) + 2n
if (b.status === 201 && onHand !== undefined && BigInt(onHand) !== expected) {
  console.log(`PROBLEM: on hand is ${onHand}, expected ${expected} (a delivery is added exactly)`)
  process.exit(3)
}
console.log('OK: on hand is exact or the delivery was refused')
process.exit(0)
