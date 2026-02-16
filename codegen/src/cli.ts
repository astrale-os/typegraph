#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { generate } from './generate'
import { normalizeIR } from './loader'

const args = process.argv.slice(2)

if (args.length === 0 || args.includes('--help')) {
  console.log(`Usage: typegraph-codegen <ir.json> [--out <path>] [--scaffold <path>]

Arguments:
  ir.json        Path to compiled SchemaIR JSON
  --out          Output path (default: schema.generated.ts)
  --scaffold     Write methods.ts scaffold (skips if file exists)`)
  process.exit(args.includes('--help') ? 0 : 1)
}

const irPaths: string[] = []
let outPath = resolve('schema.generated.ts')
let scaffoldPath: string | undefined

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') {
    outPath = resolve(args[++i])
  } else if (args[i] === '--scaffold') {
    scaffoldPath = resolve(args[++i])
  } else if (!args[i].startsWith('-')) {
    irPaths.push(resolve(args[i]))
  }
}

if (irPaths.length === 0) {
  console.error('Error: at least one IR JSON file is required')
  process.exit(1)
}

const inputs = irPaths.map((p) => {
  const raw = JSON.parse(readFileSync(p, 'utf-8'))
  return normalizeIR(raw)
})

const { source, scaffold } = generate(inputs)

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, source, 'utf-8')
console.log(`✓ Generated ${outPath} from ${irPaths.length} schema(s)`)

if (scaffoldPath && scaffold) {
  if (existsSync(scaffoldPath)) {
    console.log(`⏭ Scaffold skipped (file exists): ${scaffoldPath}`)
  } else {
    mkdirSync(dirname(scaffoldPath), { recursive: true })
    writeFileSync(scaffoldPath, scaffold, 'utf-8')
    console.log(`✓ Scaffold written: ${scaffoldPath}`)
  }
}
