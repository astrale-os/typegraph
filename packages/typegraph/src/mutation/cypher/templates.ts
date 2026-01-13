/**
 * Cypher Templates for Mutations
 *
 * Neo4j/Memgraph Cypher implementation of mutation templates.
 */

import type {
  MutationTemplateProvider,
  NodeTemplateProvider,
  EdgeTemplateProvider,
  HierarchyTemplateProvider,
  BatchTemplateProvider,
  TemplateUtils,
} from '../template-provider'

// =============================================================================
// NODE OPERATIONS
// =============================================================================

const nodeTemplates: NodeTemplateProvider = {
  create: (label: string) =>
    `
    CREATE (n:${label})
    SET n = $props, n.id = $id
    RETURN n
  `.trim(),

  update: (label: string) =>
    `
    MATCH (n:${label} {id: $id})
    SET n += $props
    RETURN n
  `.trim(),

  delete: (label: string) =>
    `
    MATCH (n:${label} {id: $id})
    DETACH DELETE n
    RETURN count(n) > 0 as deleted
  `.trim(),

  deleteKeepEdges: (label: string) =>
    `
    MATCH (n:${label} {id: $id})
    DELETE n
    RETURN count(n) > 0 as deleted
  `.trim(),

  getById: (label: string) =>
    `
    MATCH (n:${label} {id: $id})
    RETURN n
  `.trim(),

  clone: (label: string) =>
    `
    MATCH (source:${label} {id: $sourceId})
    CREATE (clone:${label})
    SET clone = properties(source), clone.id = $newId, clone += $overrides
    RETURN clone
  `.trim(),

  upsert: (label: string) =>
    `
    MERGE (n:${label} {id: $id})
    ON CREATE SET n = $createProps, n.id = $id
    ON MATCH SET n += $updateProps
    RETURN n,
      CASE WHEN n.createdAt IS NULL THEN true ELSE false END as created
  `.trim(),
}

// =============================================================================
// EDGE OPERATIONS
// =============================================================================

const edgeTemplates: EdgeTemplateProvider = {
  create: (edgeType: string) =>
    `
    MATCH (a {id: $fromId}), (b {id: $toId})
    CREATE (a)-[r:${edgeType}]->(b)
    SET r = $props, r.id = $edgeId
    RETURN r, a.id as fromId, b.id as toId
  `.trim(),

  createNoProps: (edgeType: string) =>
    `
    MATCH (a {id: $fromId}), (b {id: $toId})
    CREATE (a)-[r:${edgeType} {id: $edgeId}]->(b)
    RETURN r, a.id as fromId, b.id as toId
  `.trim(),

  update: (edgeType: string) =>
    `
    MATCH (a {id: $fromId})-[r:${edgeType}]->(b {id: $toId})
    SET r += $props
    RETURN r, a.id as fromId, b.id as toId
  `.trim(),

  deleteByEndpoints: (edgeType: string) =>
    `
    MATCH (a {id: $fromId})-[r:${edgeType}]->(b {id: $toId})
    DELETE r
    RETURN count(r) > 0 as deleted
  `.trim(),

  deleteById: (edgeType: string) =>
    `
    MATCH ()-[r:${edgeType} {id: $edgeId}]->()
    DELETE r
    RETURN count(r) > 0 as deleted
  `.trim(),

  exists: (edgeType: string) =>
    `
    MATCH (a {id: $fromId})-[r:${edgeType}]->(b {id: $toId})
    RETURN count(r) > 0 as exists
  `.trim(),
}

// =============================================================================
// HIERARCHY OPERATIONS
// =============================================================================

const hierarchyTemplates: HierarchyTemplateProvider = {
  createChild: (nodeLabel: string, edgeType: string) =>
    `
    MATCH (parent {id: $parentId})
    CREATE (child:${nodeLabel})
    SET child = $props, child.id = $id
    CREATE (child)-[:${edgeType}]->(parent)
    RETURN child
  `.trim(),

  move: (edgeType: string) =>
    `
    MATCH (n {id: $nodeId})-[oldRel:${edgeType}]->(oldParent)
    MATCH (newParent {id: $newParentId})
    WITH n, oldRel, oldParent, newParent
    DELETE oldRel
    CREATE (n)-[:${edgeType}]->(newParent)
    RETURN n.id as nodeId, oldParent.id as previousParentId, newParent.id as newParentId
  `.trim(),

  moveOrphan: (edgeType: string) =>
    `
    MATCH (n {id: $nodeId})
    WHERE NOT (n)-[:${edgeType}]->()
    MATCH (newParent {id: $newParentId})
    CREATE (n)-[:${edgeType}]->(newParent)
    RETURN n.id as nodeId, null as previousParentId, newParent.id as newParentId
  `.trim(),

  getParent: (edgeType: string) =>
    `
    MATCH (n {id: $nodeId})-[:${edgeType}]->(parent)
    RETURN parent.id as parentId
  `.trim(),

  wouldCreateCycle: (edgeType: string) =>
    `
    MATCH (target {id: $newParentId})
    MATCH path = (target)-[:${edgeType}*0..]->(ancestor)
    WHERE ancestor.id = $nodeId
    RETURN count(path) > 0 as wouldCycle
  `.trim(),

  deleteSubtree: (edgeType: string) =>
    `
    MATCH (root {id: $rootId})
    CALL {
      WITH root
      MATCH (root)<-[:${edgeType}*0..]-(descendant)
      RETURN collect(distinct descendant) as nodes
    }
    WITH nodes
    UNWIND nodes as n
    DETACH DELETE n
    RETURN size(nodes) as deletedNodes
  `.trim(),

  getSubtree: (edgeType: string) =>
    `
    MATCH path = (root {id: $rootId})<-[:${edgeType}*0..]-(descendant)
    WITH descendant, length(path) as depth, labels(descendant) as nodeLabels
    RETURN descendant as node, depth, nodeLabels
    ORDER BY depth
  `.trim(),

  cloneWithParent: (nodeLabel: string, edgeType: string) =>
    `
    MATCH (source:${nodeLabel} {id: $sourceId})
    MATCH (parent {id: $parentId})
    CREATE (clone:${nodeLabel})
    SET clone = properties(source), clone.id = $newId, clone += $overrides
    CREATE (clone)-[:${edgeType}]->(parent)
    RETURN clone
  `.trim(),

  clonePreserveParent: (nodeLabel: string, edgeType: string) =>
    `
    MATCH (source:${nodeLabel} {id: $sourceId})-[:${edgeType}]->(parent)
    CREATE (clone:${nodeLabel})
    SET clone = properties(source), clone.id = $newId, clone += $overrides
    CREATE (clone)-[:${edgeType}]->(parent)
    RETURN clone
  `.trim(),
}

// =============================================================================
// BATCH OPERATIONS
// =============================================================================

const batchTemplates: BatchTemplateProvider = {
  // Node batch operations
  createMany: (label: string) =>
    `
    UNWIND $items as item
    CREATE (n:${label})
    SET n = item.props, n.id = item.id
    RETURN n
  `.trim(),

  updateMany: (label: string) =>
    `
    UNWIND $updates as update
    MATCH (n:${label} {id: update.id})
    SET n += update.props
    RETURN n
  `.trim(),

  deleteMany: (label: string) =>
    `
    UNWIND $ids as nodeId
    MATCH (n:${label} {id: nodeId})
    DETACH DELETE n
    RETURN count(n) as deletedCount
  `.trim(),

  // Edge batch operations
  linkMany: (edgeType: string) =>
    `
    UNWIND $links as link
    MATCH (a {id: link.from}), (b {id: link.to})
    CREATE (a)-[r:${edgeType}]->(b)
    SET r = coalesce(link.data, {}), r.id = link.id
    RETURN r, a.id as fromId, b.id as toId
  `.trim(),

  unlinkMany: (edgeType: string) =>
    `
    UNWIND $links as link
    MATCH (a {id: link.from})-[r:${edgeType}]->(b {id: link.to})
    DELETE r
    RETURN count(r) as deleted
  `.trim(),

  unlinkAllFrom: (edgeType: string) =>
    `
    MATCH (a {id: $from})-[r:${edgeType}]->()
    DELETE r
    RETURN count(r) as deleted
  `.trim(),

  unlinkAllTo: (edgeType: string) =>
    `
    MATCH ()-[r:${edgeType}]->(b {id: $to})
    DELETE r
    RETURN count(r) as deleted
  `.trim(),
}

// =============================================================================
// UTILITIES
// =============================================================================

const utils: TemplateUtils = {
  buildParams(params: Record<string, unknown>): Record<string, unknown> {
    const filtered: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        filtered[key] = value
      }
    }
    return filtered
  },

  sanitizeIdentifier(identifier: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
      throw new Error(`Invalid identifier: ${identifier}`)
    }
    return identifier
  },
}

// =============================================================================
// CYPHER PROVIDER
// =============================================================================

/**
 * Cypher template provider for Neo4j/Memgraph.
 */
export const CypherTemplates: MutationTemplateProvider = {
  name: 'cypher',
  node: nodeTemplates,
  edge: edgeTemplates,
  hierarchy: hierarchyTemplates,
  batch: batchTemplates,
  utils,
}
