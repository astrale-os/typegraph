#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { generate } from './generate'
import { normalizeIR } from './loader'

const args = process.argv.slice(2)

if (args.length === 0 || args.includes('--help')) {
  console.log(`Usage: typegraph-codegen <ir.json> [--out <path>]

Arguments:
  ir.json    Path to compiled SchemaIR JSON
  --out      Output path (default: schema.generated.ts)`)
  process.exit(args.includes('--help') ? 0 : 1)
}

const irPaths: string[] = []
let outPath = resolve('schema.generated.ts')

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') {
    outPath = resolve(args[++i])
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

const { source } = generate(inputs)

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, source, 'utf-8')

console.log(`✓ Generated ${outPath} from ${irPaths.length} schema(s)`)
