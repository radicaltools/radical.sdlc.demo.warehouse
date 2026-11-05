import { neighboursAt } from './neighbours.js'
import { buildServer } from './server.js'

const neighbours = neighboursAt(
  process.env.STOCK_URL ?? 'http://localhost:3011',
  process.env.CARRIER_URL ?? 'http://localhost:3013',
)
await buildServer(neighbours).listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3012) })
