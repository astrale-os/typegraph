/**
 * Schema Enrichment — Instance Model Configuration
 *
 * Pure helpers for enriching a schema with instance model refs
 * from a bootstrap/materialization result.
 */

import type { SchemaShape, InstanceModelConfig } from './schema'

// =============================================================================
// SCHEMA ENRICHMENT
// =============================================================================

/**
 * Enrich a schema with instance model configuration from a materialization result.
 * Returns a new schema object — does not mutate the original.
 */
export function withInstanceModel<S extends SchemaShape>(
  schema: S,
  result: { refs: Record<string, string>; implementors: Record<string, string[]> },
): S & { readonly instanceModel: InstanceModelConfig } {
  return {
    ...schema,
    instanceModel: {
      enabled: true,
      refs: result.refs,
      implementors: result.implementors,
    },
  }
}
