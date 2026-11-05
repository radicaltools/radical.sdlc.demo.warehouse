#!/usr/bin/env node
// One part of the warehouse on the ports of an exploratory run, for radical explore:
//   node tools/serve-for-explore.mjs <stock|dispatch|carrier> <stock port> <dispatch port> <carrier port>
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const [part, stock, dispatch, carrier] = process.argv.slice(2)
const ports = { stock, dispatch, carrier }
const env = { ...process.env, PORT: ports[part], STOCK_URL: `http://localhost:${stock}`, CARRIER_URL: `http://localhost:${carrier}` }
const child = part === 'carrier'
  ? spawn('node', [fileURLToPath(new URL('carrier-stand-in.mjs', import.meta.url))], { stdio: 'inherit', detached: true, env })
  : spawn('npx', ['tsx', 'src/main.ts'], { cwd: fileURLToPath(new URL(`../services/${part}`, import.meta.url)), stdio: 'inherit', detached: true, env })
const stop = () => { try { process.kill(-child.pid) } catch {} process.exit(0) }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
child.on('exit', (code) => process.exit(code ?? 1))
