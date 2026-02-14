import type { SchemaIR, GraphModel } from './model'
import { load } from './loader'
import { emitEnums } from './emit/enums'
import { emitInterfaces } from './emit/interfaces'
import { emitValidators } from './emit/validators'
import { emitSchemaValue } from './emit/schema-value'
import { emitSchemaTypes } from './emit/schema-types'
import { emitCore } from './emit/core'
import { banner, section } from './emit/utils'

export interface GenerateOptions {
  /** Override the file header. Default: @generated banner. */
  header?: string
}

export interface GenerateResult {
  /** The generated TypeScript source. */
  source: string
  /** The resolved graph model (useful for inspection/testing). */
  model: GraphModel
}

/**
 * Generate TypeScript source from one or more SchemaIR inputs.
 *
 * Pipeline: SchemaIR[] → Loader → GraphModel → Emitters → source string
 */
export function generate(inputs: SchemaIR[], options?: GenerateOptions): GenerateResult {
  const model = load(inputs)
  const parts: string[] = []

  // Header
  parts.push(options?.header ?? banner())
  parts.push('')
  parts.push("import { z } from 'zod'")
  parts.push('')

  // Enums (must come before interfaces — types reference enum names)
  const enums = emitEnums(model)
  if (enums.trim()) {
    parts.push(section('Enums'))
    parts.push('')
    parts.push(enums)
  }

  // Interfaces (type aliases, node interfaces, node types, edge payloads)
  const interfaces = emitInterfaces(model)
  if (interfaces.trim()) {
    parts.push(interfaces)
  }

  // Validators (single object with Zod schemas)
  const validators = emitValidators(model)
  if (validators.trim()) {
    parts.push(section('Validators'))
    parts.push('')
    parts.push(validators)
    parts.push('')
  }

  // Schema value (runtime graph topology)
  const schemaValue = emitSchemaValue(model)
  if (schemaValue.trim()) {
    parts.push(section('Schema'))
    parts.push('')
    parts.push(schemaValue)
    parts.push('')
  }

  // Schema type unions (SchemaNodeType, SchemaEdgeType, SchemaType)
  const schemaTypes = emitSchemaTypes(model)
  if (schemaTypes.trim()) {
    parts.push(section('Schema Types'))
    parts.push('')
    parts.push(schemaTypes)
    parts.push('')
  }

  // Core DSL (defineCore, node, edge, Refs)
  const core = emitCore(model)
  if (core.trim()) {
    parts.push(section('Core'))
    parts.push('')
    parts.push(core)
  }

  return { source: parts.join('\n'), model }
}
