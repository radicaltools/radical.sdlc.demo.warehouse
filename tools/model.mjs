#!/usr/bin/env node
// The model of the whole system lives in the architecture repository, which .radical/radical.json names
// ("model"), so radical check and radical sense run judge this repository's part of it. This fetches its
// commits into this git, so `radical diff --since` and get_changes read them, and unpacks the whole model
// into .radical/model, out of git.
//
//   node tools/model.mjs           the model at the commit .radical/reconciled.json names: what the gate
//                                  judges, so a change of the model turns nothing red here
//   node tools/model.mjs --whole [--ref <branch>]   the model as main, or a change's branch, has it, for the
//                                  agent, with the commit in .agent/desired
import { execFileSync, execSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const ARCHITECTURE = 'https://github.com/radicaltools/radical.sdlc.demo.architecture.git'
const SYSTEM = '.agent/system'
const whole = process.argv.includes('--whole')
const ref = process.argv.includes('--ref') ? process.argv[process.argv.indexOf('--ref') + 1] : 'main'
if (!/^(main|change\/\d+)$/.test(ref)) throw new Error(`Not a branch of the model: ${ref}`)

// Main and the changes in progress: a change's commits are on its branch until a person accepts it.
execFileSync('git', ['fetch', '--quiet', '--no-tags', ARCHITECTURE, '+refs/heads/main:refs/architecture/main', '+refs/heads/change/*:refs/architecture/change/*'], { stdio: 'inherit' })
const commit = whole
  ? execFileSync('git', ['rev-parse', `refs/architecture/${ref}`], { encoding: 'utf8' }).trim()
  : JSON.parse(readFileSync('.radical/reconciled.json', 'utf8')).model
rmSync(SYSTEM, { recursive: true, force: true })
rmSync('.radical/model', { recursive: true, force: true })
mkdirSync(SYSTEM, { recursive: true })
execSync(`git archive ${commit} .radical/model .radical/system.json pipeline | tar -x -C ${SYSTEM}`)
cpSync(`${SYSTEM}/.radical/model`, '.radical/model', { recursive: true })
if (whole) writeFileSync('.agent/desired', `${commit}\n`)
console.log(`The model at ${commit.slice(0, 7)} in .radical/model.`)
