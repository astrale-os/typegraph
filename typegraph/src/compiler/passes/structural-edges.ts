/**
 * Structural Edge & Meta-Label Constants
 *
 * These are the kernel prelude primitives — raw Cypher relationships
 * that form the meta-model infrastructure. They are never reified
 * and never have instance_of edges themselves.
 */

export const STRUCTURAL_EDGES = {
  INSTANCE_OF: 'instance_of',
  HAS_LINK: 'has_link',
  LINKS_TO: 'links_to',
  HAS_PARENT: 'has_parent',
  IMPLEMENTS: 'implements',
  EXTENDS: 'extends',
} as const

/** Set for O(1) lookup when checking if an edge is structural. */
export const STRUCTURAL_EDGE_SET = new Set<string>(Object.values(STRUCTURAL_EDGES))

/** Meta-model node labels (PascalCase, graph DB convention). */
export const META_LABELS = {
  NODE: 'Node',
  LINK: 'Link',
  CLASS: 'Class',
  INTERFACE: 'Interface',
} as const
