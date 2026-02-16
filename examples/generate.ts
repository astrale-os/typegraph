#!/usr/bin/env tsx
// examples/generate.ts
// ============================================================
// Compiles .krl schemas and runs codegen for each example.
//
// Usage:
//   npx tsx examples/generate.ts examples/e-commerce
//   npx tsx examples/generate.ts --all
//   npx tsx examples/generate.ts --check
// ============================================================

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, basename, dirname, join } from 'node:path'

import { compile, KERNEL_PRELUDE } from '../compiler/src/index.js'
import { generate } from '../codegen/src/generate.js'
import { normalizeIR } from '../codegen/src/loader.js'

const EXAMPLES_DIR = dirname(new URL(import.meta.url).pathname)

// ─── Core ────────────────────────────────────────────────────

function compileAndGenerate(krlSource: string): { ir: unknown; source: string } {
  const { ir, diagnostics } = compile(krlSource, { prelude: KERNEL_PRELUDE })
  const errors = diagnostics.getErrors()
  if (errors.length > 0) {
    const msg = errors.map((e) => `[${e.code}] ${e.message}`).join('\n')
    throw new Error(`KRL compilation failed:\n${msg}`)
  }
  if (!ir) throw new Error('Compilation produced no IR')

  const normalized = normalizeIR(ir as unknown as Record<string, unknown>)
  const { source } = generate([normalized])
  return { ir, source }
}

function processExample(dir: string, check: boolean): boolean {
  const krlPath = join(dir, 'schema.krl')
  if (!existsSync(krlPath)) {
    console.error(`  skip: no schema.krl in ${dir}`)
    return true
  }

  const krl = readFileSync(krlPath, 'utf-8')
  const { ir, source } = compileAndGenerate(krl)

  const irPath = join(dir, 'schema.ir.json')
  const tsPath = join(dir, 'schema.generated.ts')

  // Normalize the timestamp so output is deterministic across runs
  const irStable = { ...(ir as Record<string, unknown>) }
  if (irStable.meta && typeof irStable.meta === 'object') {
    irStable.meta = { ...(irStable.meta as Record<string, unknown>), generated_at: '' }
  }
  const irJson = JSON.stringify(irStable, null, 2) + '\n'

  if (check) {
    const existingIR = existsSync(irPath) ? readFileSync(irPath, 'utf-8') : ''
    const existingTS = existsSync(tsPath) ? readFileSync(tsPath, 'utf-8') : ''
    const stale = existingIR !== irJson || existingTS !== source
    if (stale) {
      console.error(`  STALE: ${basename(dir)} — run 'npx tsx examples/generate.ts --all' to update`)
    } else {
      console.log(`  ok: ${basename(dir)}`)
    }
    return !stale
  }

  writeFileSync(irPath, irJson, 'utf-8')
  writeFileSync(tsPath, source, 'utf-8')
  console.log(`  ✓ ${basename(dir)} → schema.ir.json + schema.generated.ts`)
  return true
}

// ─── CLI ─────────────────────────────────────────────────────

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage:
  npx tsx examples/generate.ts <dir>       Generate for a single example
  npx tsx examples/generate.ts --all       Generate for all examples
  npx tsx examples/generate.ts --check     Verify generated files are up-to-date`)
  process.exit(0)
}

const check = args.includes('--check')
const all = args.includes('--all') || check

if (all) {
  console.log(check ? 'Checking examples…' : 'Generating examples…')
  const dirs = readdirSync(EXAMPLES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(EXAMPLES_DIR, d.name))

  let ok = true
  for (const dir of dirs) {
    if (!processExample(dir, check)) ok = false
  }
  if (!ok) process.exit(1)
} else {
  const dir = resolve(args[0])
  if (!existsSync(dir)) {
    console.error(`Directory not found: ${dir}`)
    process.exit(1)
  }
  processExample(dir, false)
}
