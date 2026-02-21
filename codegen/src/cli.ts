#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { generate } from './generate'
import { normalizeIR } from './loader'
import { compileGsl } from './compile-gsl'

const args = process.argv.slice(2)

if (args.length === 0 || args.includes('--help')) {
  console.log(`Usage: typegraph-codegen <file...> [--out <path>] [--scaffold <path>]

Arguments:
  file           .gsl source file or .json IR file (detects by extension)
  --out          Output path (default: schema.generated.ts)
  --scaffold     Write methods.ts scaffold (skips if file exists)`)
  process.exit(args.includes('--help') ? 0 : 1)
}

const inputPaths: string[] = []
let outPath = resolve('schema.generated.ts')
let scaffoldPath: string | undefined

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') {
    outPath = resolve(args[++i])
  } else if (args[i] === '--scaffold') {
    scaffoldPath = resolve(args[++i])
  } else if (!args[i].startsWith('-')) {
    inputPaths.push(resolve(args[i]))
  }
}

if (inputPaths.length === 0) {
  console.error('Error: at least one input file is required')
  process.exit(1)
}

// Detect input type by extension: .gsl → compile, .json → load IR
const isGsl = inputPaths.every((p) => p.endsWith('.gsl'))
const isJson = inputPaths.every((p) => p.endsWith('.json'))

if (!isGsl && !isJson) {
  console.error('Error: all inputs must be the same type (.gsl or .json)')
  process.exit(1)
}

let source: string
let scaffold: string

if (isGsl) {
  if (inputPaths.length > 1) {
    console.error('Error: only one .gsl file is supported at a time')
    process.exit(1)
  }
  const gslSource = readFileSync(inputPaths[0], 'utf-8')
  const result = compileGsl(gslSource)
  source = result.source
  scaffold = result.scaffold
} else {
  const inputs = inputPaths.map((p) => {
    const raw = JSON.parse(readFileSync(p, 'utf-8'))
    return normalizeIR(raw)
  })
  const result = generate(inputs)
  source = result.source
  scaffold = result.scaffold
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, source, 'utf-8')
console.log(`✓ Generated ${outPath}`)

if (scaffoldPath && scaffold) {
  if (existsSync(scaffoldPath)) {
    console.log(`⏭ Scaffold skipped (file exists): ${scaffoldPath}`)
  } else {
    mkdirSync(dirname(scaffoldPath), { recursive: true })
    writeFileSync(scaffoldPath, scaffold, 'utf-8')
    console.log(`✓ Scaffold written: ${scaffoldPath}`)
  }
}
