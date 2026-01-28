/**
 * Graph Schema Vocabulary
 *
 * Centralizes all graph label and edge type names.
 * Short property names keep Cypher templates readable: v.parent, v.perm, v.identity.
 */

// =============================================================================
// TYPES
// =============================================================================

export type GraphVocab = {
  // Labels
  node: string
  identity: string
  type: string
  // Edges
  parent: string
  perm: string
  ofType: string
  union: string
  intersect: string
  exclude: string
}

// =============================================================================
// DEFAULTS
// =============================================================================

export const DEFAULT_VOCAB: GraphVocab = {
  node: 'Node',
  identity: 'Identity',
  type: 'Type',
  parent: 'hasParent',
  perm: 'hasPerm',
  ofType: 'ofType',
  union: 'unionWith',
  intersect: 'intersectWith',
  exclude: 'excludeWith',
}

// =============================================================================
// HELPERS
// =============================================================================

/** Merge partial vocab with defaults. */
export function resolveVocab(partial?: Partial<GraphVocab>): GraphVocab {
  return partial ? { ...DEFAULT_VOCAB, ...partial } : DEFAULT_VOCAB
}
