import type { SchemaIR, GraphModel } from './model'

import { emitBootstrap } from './emit/bootstrap'
import { emitBrandedIds } from './emit/branded-ids'
import { emitCore } from './emit/core'
import { emitEnums } from './emit/enums'
import { emitInterfaces } from './emit/interfaces'
import { emitMethodOps } from './emit/method-ops'
import { emitMethodScaffold } from './emit/method-scaffold'
import { emitMethods } from './emit/methods'
import { emitSchemaTypes } from './emit/schema-types'
import { emitSchemaValue } from './emit/schema-value'
import { emitTypemap } from './emit/typemap'
import { banner, section } from './emit/utils'
import { emitValidators } from './emit/validators'
import { load } from './loader'

export interface GenerateOptions {
  /** Override the file header. Default: @generated banner. */
  header?: string
}

export interface GenerateResult {
  /** The generated TypeScript source. */
  source: string
  /** Scaffold source for methods.ts (empty if no methods exist). */
  scaffold: string
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

  // Detect whether any methods exist — drives op import and scaffold
  const hasMethodOps =
    [...model.nodeDefs.values()].some((n) => n.allMethods.length > 0) ||
    [...model.edgeDefs.values()].some((e) => e.allMethods.length > 0)

  if (hasMethodOps) {
    parts.push("import { op } from '@astrale-os/kernel-api'")
  }
  parts.push('')

  // Enums (must come before interfaces — types reference enum names)
  const enums = emitEnums(model)
  if (enums.trim()) {
    parts.push(section('Enums'))
    parts.push('')
    parts.push(enums)
  }

  // Branded IDs (NodeId, per-node IDs, constructors)
  const brandedIds = emitBrandedIds(model)
  if (brandedIds.trim()) {
    parts.push(section('Branded IDs'))
    parts.push('')
    parts.push(brandedIds)
  }

  // Interfaces (type aliases, node interfaces, node types, edge payloads)
  const interfaces = emitInterfaces(model)
  if (interfaces.trim()) {
    parts.push(interfaces)
  }

  // Methods (method interfaces, context types, MethodsConfig, enriched node types)
  const methods = emitMethods(model)
  if (methods.trim()) {
    parts.push(section('Methods'))
    parts.push('')
    parts.push(methods)
  }

  // TypeMap (node input types, TypeMap interface, typed createGraph wrapper)
  const typemap = emitTypemap(model)
  if (typemap.trim()) {
    parts.push(section('TypeMap'))
    parts.push('')
    parts.push(typemap)
  }

  // Validators (single object with Zod schemas)
  const validators = emitValidators(model)
  if (validators.trim()) {
    parts.push(section('Validators'))
    parts.push('')
    parts.push(validators)
    parts.push('')
  }

  // Method Operations (*Ops constants — after validators, uses validators.*)
  const methodOps = emitMethodOps(model)
  if (methodOps.trim()) {
    parts.push(section('Method Operations'))
    parts.push('')
    parts.push(methodOps)
  }

  // Schema value (runtime graph topology)
  const schemaValue = emitSchemaValue(model)
  if (schemaValue.trim()) {
    parts.push(section('Schema'))
    parts.push('')
    parts.push(schemaValue)
    parts.push('')
  }

  // Bootstrap manifest (class/interface nodes to create at install time)
  const bootstrapManifest = emitBootstrap(model)
  if (bootstrapManifest.trim()) {
    parts.push(section('Bootstrap'))
    parts.push('')
    parts.push(bootstrapManifest)
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

  const scaffold = hasMethodOps ? emitMethodScaffold(model) : ''

  return { source: parts.join('\n'), scaffold, model }
}
