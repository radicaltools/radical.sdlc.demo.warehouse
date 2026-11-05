import { buildServer } from './server.js'

await buildServer().listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3011) })
