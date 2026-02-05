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
  /** Create edge with properties. Labels enable efficient node lookup. */
  create(edgeType: string, fromLabels?: string[], toLabels?: string[]): string
  /** Create edge without properties. Labels enable efficient node lookup. */
  createNoProps(edgeType: string, fromLabels?: string[], toLabels?: string[]): string
  /** Update edge by endpoints. Labels enable efficient node lookup. */
  update(edgeType: string, fromLabels?: string[], toLabels?: string[]): string
  /** Update edge by edge ID (no node labels needed). */
  updateById(edgeType: string): string
  /** Delete edge by endpoints. Labels enable efficient node lookup. */
  deleteByEndpoints(edgeType: string, fromLabels?: string[], toLabels?: string[]): string
  /** Delete edge by edge ID (no node labels needed). */
  deleteById(edgeType: string): string
  /** Check if edge exists between endpoints. Labels enable efficient node lookup. */
  exists(edgeType: string, fromLabels?: string[], toLabels?: string[]): string
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
  // Edge batch operations - labels enable efficient node lookup
  linkMany(edgeType: string, fromLabels?: string[], toLabels?: string[]): string
  unlinkMany(edgeType: string, fromLabels?: string[], toLabels?: string[]): string
  unlinkAllFrom(edgeType: string, fromLabels?: string[]): string
  unlinkAllTo(edgeType: string, toLabels?: string[]): string
}

export interface TemplateUtils {
  /** Build parameters object, filtering undefined values */
  buildParams(params: Record<string, unknown>): Record<string, unknown>
  /** Sanitize identifier for safe interpolation */
  sanitizeIdentifier(identifier: string): string
}
