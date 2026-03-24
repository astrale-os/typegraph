// src/kernel-prelude.ts
// ============================================================
// Kernel Registry Builder
//
// Compiles kernel.gsl (the single source of truth for
// Astrale's graph meta-model) and registers the result in a
// SchemaRegistry under the kernel URI.
//
// Accepts an optional source string for bundled environments
// (VS Code extension) where filesystem access isn't available.
// ============================================================

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

import { DiagnosticBag } from './diagnostics'
import { lex } from './lexer'
import { lower } from './lower/index'
import { parse } from './parser/index'
import { KERNEL_PRELUDE } from './prelude'
import { MapSchemaRegistry } from './registry'
import { resolve as resolveSchema, createBuiltinScope } from './resolver/index'

export const KERNEL_SCHEMA_URI = 'https://kernel.astrale.ai/v1'

let cachedRegistry: MapSchemaRegistry | null = null

/**
 * Build a MapSchemaRegistry containing the kernel schema.
 *
 * @param source - Optional GSL source string. If omitted, reads
 *                 kernel.gsl from disk (for CLI / dev).
 *                 Pass the source explicitly in bundled environments.
 */
export function buildKernelRegistry(source?: string): MapSchemaRegistry {
  if (cachedRegistry) return cachedRegistry

  const gslSource = source ?? readKernelSchemaFromDisk()

  const diagnostics = new DiagnosticBag()
  const baseScope = createBuiltinScope(KERNEL_PRELUDE.scalars)

  const { tokens } = lex(gslSource, diagnostics)
  const { cst } = parse(tokens, diagnostics)
  const { ast } = lower(cst, diagnostics)
  const { schema } = resolveSchema(ast, baseScope, diagnostics)

  if (diagnostics.hasErrors()) {
    const errors = diagnostics.getErrors()
    throw new Error(
      `kernel.gsl compilation failed:\n${errors.map((e) => `[${e.code}] ${e.message}`).join('\n')}`,
    )
  }

  const registry = new MapSchemaRegistry()
  registry.register(KERNEL_SCHEMA_URI, schema)
  cachedRegistry = registry
  return registry
}

function readKernelSchemaFromDisk(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const gslPath = resolve(__dirname, '..', 'kernel.gsl')
  return readFileSync(gslPath, 'utf-8')
}
