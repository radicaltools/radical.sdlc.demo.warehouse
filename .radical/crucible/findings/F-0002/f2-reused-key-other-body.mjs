// Finding 2: a reservation sent with a key already seen but another body. The rule
// ("Reused key refused") says 422 and hold nothing. The stock ledger returns the
// first reservation for the key, whatever the body. Exit 3 when the answer is not 422
// or when more than the first 3 are held.

const STOCK = 'http://localhost:4602'
const stamp = Date.now()
const sku = `f2-sku-${stamp}`
const key = `f2-key-${stamp}`

const post = (path, key, body) => fetch(`${STOCK}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
  body: JSON.stringify(body),
})

async function main() {
  const receipt = await post('/stock/receipts', null, { sku, quantity: 10 })
  if (receipt.status !== 201) {
    console.log(`receipt answered ${receipt.status}; cannot run`)
    process.exit(1)
  }
  const first = await post('/reservations', key, { lines: [{ sku, quantity: 3 }] })
  const firstBody = await first.json()
  console.log(`first (3 of ${sku}, key ${key}): ${first.status} ${JSON.stringify(firstBody)}`)

  const second = await post('/reservations', key, { lines: [{ sku, quantity: 4 }] })
  const secondBody = await second.text()
  console.log(`second (4 of ${sku}, same key): ${second.status} ${secondBody}`)

  const availability = await (await fetch(`${STOCK}/stock/${encodeURIComponent(sku)}`)).json()
  console.log(`after: onHand ${availability.onHand}, held ${availability.held}, available ${availability.available}`)

  if (second.status !== 422) {
    console.log(`PROBLEM: a reused key with another body answered ${second.status}, not 422`)
    process.exit(3)
  }
  console.log('reused key with another body refused')
  process.exit(0)
}

main().catch((error) => {
  console.log(`cannot reach the stack: ${error.message}`)
  process.exit(1)
})
