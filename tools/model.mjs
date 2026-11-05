#!/usr/bin/env node
// The model of the whole system lives in the architecture repository. This fetches its commits into
// this git, so `radical diff --since` and get_changes read them, and unpacks the model into .radical/model,
// out of git.
//
//   node tools/model.mjs           this repository's part, at the commit .radical/reconciled.json names: what
//                                  the gate judges, so a change of the model turns nothing red here
//   node tools/model.mjs --whole   the whole model as main has it, for the agent, with the part in .agent/part
//                                  and the commit in .agent/desired
import { execFileSync, execSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const ARCHITECTURE = 'https://github.com/radicaltools/radical.tools.sdlc.demo.3.architecture.git'
const SYSTEM = '.agent/system'
const WHOLE = `${SYSTEM}/.radical/model`
const whole = process.argv.includes('--whole')

execFileSync('git', ['fetch', '--quiet', '--no-tags', ARCHITECTURE, 'main'], { stdio: 'inherit' })
const commit = whole
  ? execFileSync('git', ['rev-parse', 'FETCH_HEAD'], { encoding: 'utf8' }).trim()
  : JSON.parse(readFileSync('.radical/reconciled.json', 'utf8')).model
rmSync(SYSTEM, { recursive: true, force: true })
rmSync('.radical/model', { recursive: true, force: true })
mkdirSync(SYSTEM, { recursive: true })
execSync(`git archive ${commit} .radical/model .radical/system.json pipeline | tar -x -C ${SYSTEM}`)
const part = (out) => execFileSync('node', [`${SYSTEM}/pipeline/part.mjs`, WHOLE, out, '.radical/radical.json'], { stdio: 'inherit' })
if (whole) {
  cpSync(WHOLE, '.radical/model', { recursive: true })
  part('.agent/part')
  writeFileSync('.agent/desired', `${commit}\n`)
} else {
  part('.radical/model')
}
console.log(`The model at ${commit.slice(0, 7)} in .radical/model.`)
