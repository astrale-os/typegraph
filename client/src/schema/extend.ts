/**
 * Schema Extension
 *
 * Pure utility for merging additional node/edge/method definitions
 * into an existing SchemaShape object in-place.
 *
 * All internal components (GraphQueryImpl, GraphMutationsImpl,
 * MutationValidator, HooksRunner) share the same schema reference,
 * so in-place mutation propagates to all consumers automatically.
 */

import type { SchemaShape, SchemaNodeDef, SchemaEdgeDef, SchemaMethodDef } from './types'

/**
 * Result of merging a schema extension, indicating what changed.
 */
export interface MergeResult {
  /** Whether the pipeline cache should be invalidated (reifyEdges/classRefs changed) */
  pipelineStale: boolean
}

/**
 * Merge an extension into a schema object in-place.
 *
 * Mutates the target schema's `nodes`, `edges`, `methods`, `scalars`,
 * `reifyEdges`, and `classRefs` properties. All downstream consumers
 * holding a reference to the same schema object see the changes immediately.
 *
 * @returns Info about what changed, for cache invalidation decisions
 */
export function mergeSchemaExtension(
  target: SchemaShape,
  extension: Partial<SchemaShape>,
): MergeResult {
  // Cast away Readonly — TypeScript-only constraint, safe at runtime
  const schema = target as unknown as Record<string, unknown>
  let pipelineStale = false

  // Nodes
  if (extension.nodes) {
    Object.assign(schema.nodes as Record<string, SchemaNodeDef>, extension.nodes)
  }

  // Edges
  if (extension.edges) {
    Object.assign(schema.edges as Record<string, SchemaEdgeDef>, extension.edges)
    if (Object.values(extension.edges).some((e) => e.reified)) {
      pipelineStale = true
    }
  }

  // Methods (deep merge by type name)
  if (extension.methods) {
    if (!schema.methods) {
      schema.methods = {}
    }
    for (const [typeName, methodDefs] of Object.entries(extension.methods)) {
      const methods = schema.methods as Record<string, Record<string, SchemaMethodDef>>
      if (!methods[typeName]) {
        methods[typeName] = {}
      }
      Object.assign(methods[typeName], methodDefs)
    }
  }

  // Scalars (deduplicated append)
  if (extension.scalars && extension.scalars.length > 0) {
    const existing = target.scalars ?? []
    schema.scalars = [...new Set([...existing, ...extension.scalars])]
  }

  // ReifyEdges flag
  if (extension.reifyEdges !== undefined && extension.reifyEdges !== target.reifyEdges) {
    schema.reifyEdges = extension.reifyEdges
    pipelineStale = true
  }

  // classRefs (additive merge — supports multi-distribution)
  if (extension.classRefs !== undefined) {
    if (!target.classRefs) {
      pipelineStale = true
    }
    schema.classRefs = { ...target.classRefs, ...extension.classRefs }
  }

  return { pipelineStale }
}
