export { generate } from './generate'
export type { GenerateOptions, GenerateResult } from './generate'

export { load, normalizeIR, ConflictError } from './loader'
export type { LoadOptions } from './loader'

export type {
  GraphModel,
  ResolvedAlias,
  ResolvedNode,
  ResolvedEdge,
  SchemaIR,
  ClassDef,
  NodeDef,
  EdgeDef,
} from './model'

export { emitSchemaTypes } from './emit/schema-types'
export { emitCore } from './emit/core'
