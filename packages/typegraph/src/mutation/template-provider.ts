/**
 * Template Provider Interface
 *
 * Abstraction layer for mutation query generation.
 * Allows plugging different query languages (Cypher, Gremlin, SQL, etc.)
 */

// =============================================================================
// TEMPLATE PROVIDER INTERFACE
// =============================================================================

/**
 * Interface for generating mutation queries.
 * Implement this to support different query languages.
 */
export interface MutationTemplateProvider {
  readonly name: string

  // Node operations
  node: NodeTemplateProvider
  // Edge operations
  edge: EdgeTemplateProvider
  // Hierarchy operations
  hierarchy: HierarchyTemplateProvider
  // Batch operations
  batch: BatchTemplateProvider
  // Utilities
  utils: TemplateUtils
}

export interface NodeTemplateProvider {
  create(label: string): string
  update(label: string): string
  delete(label: string): string
  deleteKeepEdges(label: string): string
  getById(label: string): string
  clone(label: string): string
  upsert(label: string): string
}

export interface EdgeTemplateProvider {
  create(edgeType: string): string
  createNoProps(edgeType: string): string
  update(edgeType: string): string
  deleteByEndpoints(edgeType: string): string
  deleteById(edgeType: string): string
  exists(edgeType: string): string
}

export interface HierarchyTemplateProvider {
  createChild(nodeLabel: string, edgeType: string): string
  move(edgeType: string): string
  moveOrphan(edgeType: string): string
  getParent(edgeType: string): string
  wouldCreateCycle(edgeType: string): string
  deleteSubtree(edgeType: string): string
  getSubtree(edgeType: string): string
  cloneWithParent(nodeLabel: string, edgeType: string): string
  clonePreserveParent(nodeLabel: string, edgeType: string): string
}

export interface BatchTemplateProvider {
  // Node batch operations
  createMany(label: string): string
  updateMany(label: string): string
  deleteMany(label: string): string
  // Edge batch operations
  linkMany(edgeType: string): string
  unlinkMany(edgeType: string): string
  unlinkAllFrom(edgeType: string): string
  unlinkAllTo(edgeType: string): string
}

export interface TemplateUtils {
  /** Build parameters object, filtering undefined values */
  buildParams(params: Record<string, unknown>): Record<string, unknown>
  /** Sanitize identifier for safe interpolation */
  sanitizeIdentifier(identifier: string): string
}
