export { generate } from './generate'
export type { GenerateOptions, GenerateResult } from './generate'

export { load, normalizeIR, ConflictError } from './loader'
export type { LoadOptions } from './loader'

export type {
  GraphModel,
  ResolvedAlias,
  ResolvedNode,
  ResolvedEdge,
  MethodDef,
  MethodParam,
  SchemaIR,
  ClassDef,
  NodeDef,
  EdgeDef,
} from './model'

export { emitSchemaTypes } from './emit/schema-types'
export { emitCore } from './emit/core'

// ─── High-level compile + generate ──────────────────────────

export { compileGsl } from './compile-gsl'
export type { CompileGslOptions, CompileGslResult } from './compile-gsl'

// Re-export compiler prelude for convenience
export { KERNEL_PRELUDE, DEFAULT_PRELUDE } from '@astrale/kernel-compiler'
export type { Prelude } from '@astrale/kernel-compiler'
