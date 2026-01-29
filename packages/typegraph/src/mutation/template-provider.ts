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
  create(labels: string[]): string
  update(labels: string[]): string
  delete(labels: string[]): string
  deleteKeepEdges(labels: string[]): string
  getById(labels: string[]): string
  clone(labels: string[]): string
  upsert(labels: string[]): string
}

export interface EdgeTemplateProvider {
  create(edgeType: string): string
  createNoProps(edgeType: string): string
  update(edgeType: string): string
  updateById(edgeType: string): string
  deleteByEndpoints(edgeType: string): string
  deleteById(edgeType: string): string
  exists(edgeType: string): string
}

export interface HierarchyTemplateProvider {
  createChild(nodeLabels: string[], edgeType: string): string
  move(edgeType: string): string
  moveOrphan(edgeType: string): string
  getParent(edgeType: string): string
  wouldCreateCycle(edgeType: string): string
  deleteSubtree(edgeType: string): string
  getSubtree(edgeType: string): string
  cloneWithParent(nodeLabels: string[], edgeType: string): string
  clonePreserveParent(nodeLabels: string[], edgeType: string): string
}

export interface BatchTemplateProvider {
  // Node batch operations
  createMany(labels: string[]): string
  updateMany(labels: string[]): string
  deleteMany(labels: string[]): string
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
