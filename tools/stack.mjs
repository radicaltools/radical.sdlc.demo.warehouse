#!/usr/bin/env node
// Starts the warehouse on this machine, on the ports docker compose uses, with a
// stand-in for the carrier, until Ctrl+C.
import { spawn } from 'node:child_process'

const children = [
  ...['stock', 'dispatch'].map((service) => spawn('npx', ['tsx', 'src/main.ts'], { cwd: `services/${service}`, stdio: 'inherit', detached: true })),
  spawn('node', ['tools/carrier-stand-in.mjs'], { stdio: 'inherit', detached: true }),
]
const stop = () => { for (const c of children) { try { process.kill(-c.pid) } catch {} } process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
