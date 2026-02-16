#!/usr/bin/env tsx
// examples/generate.ts
// ============================================================
// Compiles .gsl schemas and runs codegen for each example.
//
// Usage:
//   npx tsx examples/generate.ts examples/e-commerce
//   npx tsx examples/generate.ts --all
//   npx tsx examples/generate.ts --check
//   npx tsx examples/generate.ts --all --scaffold
// ============================================================

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, basename, dirname, join } from 'node:path'

import { compile, KERNEL_PRELUDE } from '../compiler/src/index.js'
import { generate } from '../codegen/src/generate.js'
import { normalizeIR } from '../codegen/src/loader.js'

const EXAMPLES_DIR = dirname(new URL(import.meta.url).pathname)

// ─── Core ────────────────────────────────────────────────────

function compileAndGenerate(gslSource: string): { ir: unknown; source: string; scaffold: string } {
  const { ir, diagnostics } = compile(gslSource, { prelude: KERNEL_PRELUDE })
  const errors = diagnostics.getErrors()
  if (errors.length > 0) {
    const msg = errors.map((e) => `[${e.code}] ${e.message}`).join('\n')
    throw new Error(`GSL compilation failed:\n${msg}`)
  }
  if (!ir) throw new Error('Compilation produced no IR')

  const normalized = normalizeIR(ir as unknown as Record<string, unknown>)
  const { source, scaffold } = generate([normalized])
  return { ir, source, scaffold }
}

function processExample(dir: string, check: boolean, writeScaffold: boolean): boolean {
  const gslPath = join(dir, 'schema.gsl')
  if (!existsSync(gslPath)) {
    console.error(`  skip: no schema.hsl in ${dir}`)
    return true
  }

  const gsl = readFileSync(gslPath, 'utf-8')
  const { ir, source, scaffold } = compileAndGenerate(gsl)

  const irPath = join(dir, 'schema.ir.json')
  const tsPath = join(dir, 'schema.generated.ts')
  const scaffoldPath = join(dir, 'methods.ts')

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
      console.error(
        `  STALE: ${basename(dir)} — run 'npx tsx examples/generate.ts --all' to update`,
      )
    } else {
      console.log(`  ok: ${basename(dir)}`)
    }
    return !stale
  }

  writeFileSync(irPath, irJson, 'utf-8')
  writeFileSync(tsPath, source, 'utf-8')
  console.log(`  ✓ ${basename(dir)} → schema.ir.json + schema.generated.ts`)

  if (writeScaffold && scaffold) {
    if (existsSync(scaffoldPath)) {
      console.log(`  ⏭ ${basename(dir)}/methods.ts already exists — scaffold skipped`)
    } else {
      writeFileSync(scaffoldPath, scaffold, 'utf-8')
      console.log(`  ✓ ${basename(dir)} → methods.ts (scaffold)`)
    }
  }

  return true
}

// ─── CLI ─────────────────────────────────────────────────────

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage:
  npx tsx examples/generate.ts <dir>       Generate for a single example
  npx tsx examples/generate.ts --all       Generate for all examples
  npx tsx examples/generate.ts --check     Verify generated files are up-to-date
  npx tsx examples/generate.ts --scaffold  Write methods.ts scaffold (skips if exists)`)
  process.exit(0)
}

const check = args.includes('--check')
const all = args.includes('--all') || check
const scaffold = args.includes('--scaffold')

if (all) {
  console.log(check ? 'Checking examples…' : 'Generating examples…')
  const dirs = readdirSync(EXAMPLES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'node_modules')
    .map((d) => join(EXAMPLES_DIR, d.name))

  let ok = true
  for (const dir of dirs) {
    if (!processExample(dir, check, scaffold)) ok = false
  }
  if (!ok) process.exit(1)
} else {
  const dir = resolve(args[0])
  if (!existsSync(dir)) {
    console.error(`Directory not found: ${dir}`)
    process.exit(1)
  }
  processExample(dir, false, scaffold)
}
