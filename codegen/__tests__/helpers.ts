import { compile, KERNEL_PRELUDE, type SchemaIR } from '@astrale/kernel-compiler'
import { generate, type GenerateResult } from '../src/generate.js'
import { normalizeIR, load, type GraphModel } from '../src/index.js'

/**
 * Compile a KRL source string using the kernel prelude.
 * Throws if compilation produces errors.
 */
export function compileKRL(source: string): SchemaIR {
  const { ir, diagnostics } = compile(source, { prelude: KERNEL_PRELUDE })
  const errors = diagnostics.getErrors()
  if (errors.length > 0) {
    const msg = errors.map((e) => `[${e.code}] ${e.message}`).join('\n')
    throw new Error(`KRL compilation failed:\n${msg}`)
  }
  if (!ir) throw new Error('Compilation produced no IR')
  return ir
}

/**
 * Compile KRL → IR → CodeGen in one shot.
 * Returns the generated TypeScript source and GraphModel.
 */
export function compileAndGenerate(source: string): GenerateResult {
  const ir = compileKRL(source)
  return generate([ir])
}

/**
 * Compile multiple KRL sources independently, then generate from all.
 * Simulates multi-schema merging.
 */
export function mergeAndGenerate(...sources: string[]): GenerateResult {
  const irs = sources.map(compileKRL)
  return generate(irs)
}

/**
 * Compile KRL and build the GraphModel (loader output) without generating code.
 * Useful for testing the model directly.
 */
export function compileToModel(source: string): GraphModel {
  const ir = compileKRL(source)
  return load([normalizeIR(ir as unknown as Record<string, unknown>)])
}

// ─── Source Extraction ──────────────────────────────────────

export function extractValidatorBlock(source: string, name: string): string {
  const regex = new RegExp(`${name}: z\\.object\\(\\{([\\s\\S]*?)\\}\\)`, 'm')
  const match = source.match(regex)
  return match ? match[1] : ''
}

export function extractSchemaEdgeBlock(source: string, name: string): string {
  const regex = new RegExp(`${name}: \\{([\\s\\S]*?)\\n    \\},`, 'm')
  const match = source.match(regex)
  return match ? match[1] : ''
}
