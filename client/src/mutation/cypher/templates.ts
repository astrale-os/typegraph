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

import { formatLabels } from '../../helpers'

// =============================================================================
// NODE OPERATIONS
// =============================================================================

const nodeTemplates: NodeTemplateProvider = {
  create: (labels: string[]) =>
    `
    CREATE (n${formatLabels(labels)})
    SET n = $props, n.id = $id
    RETURN n
  `.trim(),

  createWithLinks: (labels: string[], links: Array<{ edgeType: string; targetAlias: string }>) => {
    const matches = links
      .filter((l) => l.targetAlias !== 'n')
      .map((l) => `MATCH (${l.targetAlias} {id: $${l.targetAlias}Id})`)
      .join('\n    ')

    const creates = links
      .map((l) => `CREATE (n)-[:${l.edgeType}]->(${l.targetAlias})`)
      .join('\n    ')

    return [
      matches,
      `CREATE (n${formatLabels(labels)})`,
      `SET n = $props, n.id = $id`,
      creates,
      `RETURN n`,
    ]
      .filter(Boolean)
      .join('\n    ')
      .trim()
  },

  update: (labels: string[]) =>
    `
    MATCH (n${formatLabels(labels)} {id: $id})
    SET n += $props
    RETURN n
  `.trim(),

  delete: (labels: string[]) =>
    `
    MATCH (n${formatLabels(labels)} {id: $id})
    DETACH DELETE n
    RETURN count(n) > 0 as deleted
  `.trim(),

  deleteKeepEdges: (labels: string[]) =>
    `
    MATCH (n${formatLabels(labels)} {id: $id})
    OPTIONAL MATCH (n)-[r]-()
    WITH n, count(r) as relCount
    WHERE relCount = 0
    DELETE n
    RETURN true as deleted, relCount
  `.trim(),

  getById: (labels: string[]) =>
    `
    MATCH (n${formatLabels(labels)} {id: $id})
    RETURN n
  `.trim(),

  clone: (labels: string[]) =>
    `
    MATCH (source${formatLabels(labels)} {id: $sourceId})
    CREATE (clone${formatLabels(labels)})
    SET clone = properties(source), clone.id = $newId, clone += $overrides
    RETURN clone
  `.trim(),

  upsert: (labels: string[]) =>
    `
    MERGE (n${formatLabels(labels)} {id: $id})
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
  create: (edgeType: string, fromLabels?: string[], toLabels?: string[]) =>
    `
    MATCH (a${formatLabels(fromLabels ?? [])} {id: $fromId}), (b${formatLabels(toLabels ?? [])} {id: $toId})
    CREATE (a)-[r:${edgeType}]->(b)
    SET r = $props, r.id = $edgeId
    RETURN r, a.id as fromId, b.id as toId
  `.trim(),

  createNoProps: (edgeType: string, fromLabels?: string[], toLabels?: string[]) =>
    `
    MATCH (a${formatLabels(fromLabels ?? [])} {id: $fromId}), (b${formatLabels(toLabels ?? [])} {id: $toId})
    CREATE (a)-[r:${edgeType} {id: $edgeId}]->(b)
    RETURN r, a.id as fromId, b.id as toId
  `.trim(),

  update: (edgeType: string, fromLabels?: string[], toLabels?: string[]) =>
    `
    MATCH (a${formatLabels(fromLabels ?? [])} {id: $fromId})-[r:${edgeType}]->(b${formatLabels(toLabels ?? [])} {id: $toId})
    SET r += $props
    RETURN r, a.id as fromId, b.id as toId
  `.trim(),

  updateById: (edgeType: string) =>
    `
    MATCH (a)-[r:${edgeType} {id: $edgeId}]->(b)
    SET r += $props
    RETURN r, a.id as fromId, b.id as toId
  `.trim(),

  deleteByEndpoints: (edgeType: string, fromLabels?: string[], toLabels?: string[]) =>
    `
    MATCH (a${formatLabels(fromLabels ?? [])} {id: $fromId})-[r:${edgeType}]->(b${formatLabels(toLabels ?? [])} {id: $toId})
    DELETE r
    RETURN count(r) > 0 as deleted
  `.trim(),

  deleteById: (edgeType: string) =>
    `
    MATCH ()-[r:${edgeType} {id: $edgeId}]->()
    DELETE r
    RETURN count(r) > 0 as deleted
  `.trim(),

  exists: (edgeType: string, fromLabels?: string[], toLabels?: string[]) =>
    `
    MATCH (a${formatLabels(fromLabels ?? [])} {id: $fromId})-[r:${edgeType}]->(b${formatLabels(toLabels ?? [])} {id: $toId})
    RETURN count(r) > 0 as exists
  `.trim(),
}

// =============================================================================
// HIERARCHY OPERATIONS
// =============================================================================

const hierarchyTemplates: HierarchyTemplateProvider = {
  createChild: (nodeLabels: string[], edgeType: string) =>
    `
    MATCH (parent {id: $parentId})
    CREATE (child${formatLabels(nodeLabels)})
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

  cloneWithParent: (nodeLabels: string[], edgeType: string) =>
    `
    MATCH (source${formatLabels(nodeLabels)} {id: $sourceId})
    MATCH (parent {id: $parentId})
    CREATE (clone${formatLabels(nodeLabels)})
    SET clone = properties(source), clone.id = $newId, clone += $overrides
    CREATE (clone)-[:${edgeType}]->(parent)
    RETURN clone
  `.trim(),

  clonePreserveParent: (nodeLabels: string[], edgeType: string) =>
    `
    MATCH (source${formatLabels(nodeLabels)} {id: $sourceId})-[:${edgeType}]->(parent)
    CREATE (clone${formatLabels(nodeLabels)})
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
  createMany: (labels: string[]) =>
    `
    UNWIND $items as item
    CREATE (n${formatLabels(labels)})
    SET n = item.props, n.id = item.id
    RETURN n
  `.trim(),

  updateMany: (labels: string[]) =>
    `
    UNWIND $updates as update
    MATCH (n${formatLabels(labels)} {id: update.id})
    SET n += update.props
    RETURN n
  `.trim(),

  deleteMany: (labels: string[]) =>
    `
    UNWIND $ids as nodeId
    MATCH (n${formatLabels(labels)} {id: nodeId})
    DETACH DELETE n
    RETURN count(n) as deletedCount
  `.trim(),

  // Edge batch operations - labels enable efficient node lookup
  linkMany: (edgeType: string, fromLabels?: string[], toLabels?: string[]) =>
    `
    UNWIND $links as link
    MATCH (a${formatLabels(fromLabels ?? [])} {id: link.from}), (b${formatLabels(toLabels ?? [])} {id: link.to})
    CREATE (a)-[r:${edgeType}]->(b)
    SET r = coalesce(link.data, {}), r.id = link.id
    RETURN r, a.id as fromId, b.id as toId
  `.trim(),

  unlinkMany: (edgeType: string, fromLabels?: string[], toLabels?: string[]) =>
    `
    UNWIND $links as link
    MATCH (a${formatLabels(fromLabels ?? [])} {id: link.from})-[r:${edgeType}]->(b${formatLabels(toLabels ?? [])} {id: link.to})
    DELETE r
    RETURN count(r) as deleted
  `.trim(),

  unlinkAllFrom: (edgeType: string, fromLabels?: string[]) =>
    `
    MATCH (a${formatLabels(fromLabels ?? [])} {id: $from})-[r:${edgeType}]->()
    DELETE r
    RETURN count(r) as deleted
  `.trim(),

  unlinkAllTo: (edgeType: string, toLabels?: string[]) =>
    `
    MATCH ()-[r:${edgeType}]->(b${formatLabels(toLabels ?? [])} {id: $to})
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
