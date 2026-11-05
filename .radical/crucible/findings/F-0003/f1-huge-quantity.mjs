// F: a delivery of a huge quantity is answered 201 with on hand, available and held turned to null (Infinity).
// Exits 3 when the problem is there, 0 when it is not.
const base = 'http://localhost:4601'
const sku = `HUGE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

const receive = async (quantity) => {
  const r = await fetch(`${base}/stock/receipts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sku, quantity }),
  })
  return { status: r.status, text: await r.text() }
}

const first = await receive(1e308)
const second = await receive(1e308)
const stock = await fetch(`${base}/stock/${sku}`)
const stockText = await stock.text()

console.log('receipt 1e308 (first)  ->', first.status, first.text)
console.log('receipt 1e308 (second) ->', second.status, second.text)
console.log('GET /stock/sku         ->', stock.status, stockText)

const broken = (text) => /"(onHand|available|held)":(null|-?Infinity|NaN)/.test(text)
if (second.status === 201 && (broken(second.text) || broken(stockText))) {
  console.log('PROBLEM: on hand is not a number after two deliveries of 1e308; the answer shows null')
  process.exit(3)
}
console.log('OK: the quantities stay numbers')
process.exit(0)
