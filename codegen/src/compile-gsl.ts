/**
 * High-level GSL → TypeScript pipeline.
 *
 * Bridges the compiler (`@astrale/kernel-compiler`) and the codegen (`generate()`)
 * into a single function call. This is the programmatic API that scripts,
 * watchers, and tests should use instead of reimplementing the pipeline.
 */

import {
  compile,
  KERNEL_PRELUDE,
  createLazyFileRegistry,
  buildKernelRegistry,
} from '@astrale/kernel-compiler'
import type { Prelude, CompileOptions } from '@astrale/kernel-compiler'
import type { SchemaIR } from './model'
import { normalizeIR } from './loader'
import { generate } from './generate'
import type { GenerateResult, GenerateOptions } from './generate'

// ─── Types ──────────────────────────────────────────────────

export interface CompileGslOptions {
  /** Prelude to use. Defaults to `KERNEL_PRELUDE`. */
  prelude?: Prelude
  /** Options forwarded to the compiler (registry, sourceUri, etc.) */
  compile?: Omit<CompileOptions, 'prelude'>
  /** Options forwarded to the code generator (header, etc.) */
  generate?: GenerateOptions
}

export interface CompileGslResult {
  /** The intermediate representation produced by the compiler. */
  ir: SchemaIR
  /** Generated TypeScript source for the schema. */
  source: string
  /** Generated scaffold for methods.ts (empty string if no methods). */
  scaffold: string
  /** Full generate result including the graph model. */
  result: GenerateResult
}

// ─── Implementation ─────────────────────────────────────────

/**
 * Compile a GSL source string to TypeScript.
 *
 * Runs the full pipeline: GSL source → compile → normalize IR → generate TypeScript.
 *
 * @throws {Error} If compilation produces diagnostics errors or no IR.
 *
 * @example
 * ```typescript
 * import { compileGsl } from '@astrale/typegraph-codegen'
 *
 * const { source, scaffold, ir } = compileGsl(`
 *   node Customer {
 *     name: String
 *     email: String
 *   }
 * `)
 *
 * writeFileSync('schema.generated.ts', source)
 * writeFileSync('schema.ir.json', JSON.stringify(ir, null, 2))
 * ```
 */
export function compileGsl(gslSource: string, options?: CompileGslOptions): CompileGslResult {
  const prelude = options?.prelude ?? KERNEL_PRELUDE
  const compileOpts = { ...options?.compile }

  // Auto-create a lazy file registry when sourceUri is provided but no registry,
  // so that `extend "./other.gsl"` resolves local file dependencies.
  if (compileOpts.sourceUri && !compileOpts.registry) {
    compileOpts.registry = createLazyFileRegistry(buildKernelRegistry(), prelude)
  }

  const { ir, diagnostics } = compile(gslSource, { ...compileOpts, prelude })

  const errors = diagnostics.getErrors()
  if (errors.length > 0) {
    const msg = errors.map((e) => `[${e.code}] ${e.message}`).join('\n')
    throw new Error(`GSL compilation failed:\n${msg}`)
  }
  if (!ir) throw new Error('Compilation produced no IR')

  const normalized = normalizeIR(ir as unknown as Record<string, unknown>)
  const result = generate([normalized], options?.generate)

  return {
    ir: normalized,
    source: result.source,
    scaffold: result.scaffold,
    result,
  }
}
