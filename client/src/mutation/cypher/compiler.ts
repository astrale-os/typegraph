/**
 * Mutation Cypher Compiler
 *
 * Compiles MutationOp[] into a single Cypher query + params.
 * Handles multi-op chaining via WITH, parameter namespacing,
 * label resolution, and identifier sanitization.
 * Each op type has exactly one compilation code path — no branching.
 */

import type { SchemaShape } from '../../schema'
import type {
  MutationOp,
  CreateNodeOp,
  UpdateNodeOp,
  DeleteNodeOp,
  UpsertNodeOp,
  CloneNodeOp,
  CreateEdgeOp,
  UpdateEdgeOp,
  UpdateEdgeByIdOp,
  DeleteEdgeOp,
  DeleteEdgeByIdOp,
  MoveNodeOp,
  DeleteSubtreeOp,
  BatchCreateOp,
  BatchUpdateOp,
  BatchDeleteOp,
  BatchLinkOp,
  BatchUnlinkOp,
  UnlinkAllFromOp,
  UnlinkAllToOp,
  BatchCreateLinkNodeOp,
  BatchDeleteLinkNodeOp,
  UpdateLinkNodeOp,
  DeleteLinkNodeOp,
  DeleteLinkNodesFromOp,
  DeleteLinkNodesToOp,
} from '../ast/types'

import { resolveNodeLabels, formatLabels, edgeFrom, edgeTo } from '../../helpers'

// =============================================================================
// COMPILED OUTPUT
// =============================================================================

export interface CompiledMutation {
  readonly query: string
  readonly params: Record<string, unknown>
}

// =============================================================================
// COMPILER
// =============================================================================

export class MutationCypherCompiler {
  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Compile an array of ops into a single atomic Cypher query. */
  compile(ops: MutationOp[], schema: SchemaShape): CompiledMutation {
    if (ops.length === 0) {
      return { query: '', params: {} }
    }
    if (ops.length === 1) {
      return this.compileOne(ops[0]!, schema)
    }
    return this.compileMulti(ops, schema)
  }

  /** Compile a single op (no parameter namespacing). */
  compileOne(op: MutationOp, schema: SchemaShape): CompiledMutation {
    switch (op.type) {
      case 'createNode':
        return this.compileCreateNode(op, schema)
      case 'updateNode':
        return this.compileUpdateNode(op, schema)
      case 'deleteNode':
        return this.compileDeleteNode(op, schema)
      case 'upsertNode':
        return this.compileUpsertNode(op, schema)
      case 'cloneNode':
        return this.compileCloneNode(op, schema)
      case 'createEdge':
        return this.compileCreateEdge(op, schema)
      case 'updateEdge':
        return this.compileUpdateEdge(op, schema)
      case 'updateEdgeById':
        return this.compileUpdateEdgeById(op)
      case 'deleteEdge':
        return this.compileDeleteEdge(op, schema)
      case 'deleteEdgeById':
        return this.compileDeleteEdgeById(op)
      case 'moveNode':
        return this.compileMove(op)
      case 'deleteSubtree':
        return this.compileDeleteSubtree(op)
      case 'batchCreate':
        return this.compileBatchCreate(op, schema)
      case 'batchUpdate':
        return this.compileBatchUpdate(op, schema)
      case 'batchDelete':
        return this.compileBatchDelete(op, schema)
      case 'batchLink':
        return this.compileBatchLink(op, schema)
      case 'batchUnlink':
        return this.compileBatchUnlink(op, schema)
      case 'unlinkAllFrom':
        return this.compileUnlinkAllFrom(op, schema)
      case 'unlinkAllTo':
        return this.compileUnlinkAllTo(op, schema)
      case 'batchCreateLinkNode':
        return this.compileBatchCreateLinkNode(op)
      case 'batchDeleteLinkNode':
        return this.compileBatchDeleteLinkNode(op)
      case 'updateLinkNode':
        return this.compileUpdateLinkNode(op)
      case 'deleteLinkNode':
        return this.compileDeleteLinkNode(op)
      case 'deleteLinkNodesFrom':
        return this.compileDeleteLinkNodesFrom(op)
      case 'deleteLinkNodesTo':
        return this.compileDeleteLinkNodesTo(op)
    }
  }

  // ---------------------------------------------------------------------------
  // MoveNode orchestration helpers (called directly by impl.ts)
  // ---------------------------------------------------------------------------

  compileCycleCheck(op: MoveNodeOp): CompiledMutation {
    const edge = sanitize(op.edgeType)
    return {
      query: [
        `MATCH (target {id: $newParentId})`,
        `MATCH path = (target)-[:${edge}*0..]->(ancestor)`,
        `WHERE ancestor.id = $nodeId`,
        `RETURN count(path) > 0 as wouldCycle`,
      ].join('\n'),
      params: { nodeId: op.nodeId, newParentId: op.newParentId },
    }
  }

  compileMove(op: MoveNodeOp): CompiledMutation {
    const edge = sanitize(op.edgeType)
    return {
      query: [
        `MATCH (n {id: $nodeId})-[oldRel:${edge}]->(oldParent)`,
        `MATCH (newParent {id: $newParentId})`,
        `WITH n, oldRel, oldParent, newParent`,
        `DELETE oldRel`,
        `CREATE (n)-[:${edge}]->(newParent)`,
        `RETURN n.id as nodeId, oldParent.id as previousParentId, newParent.id as newParentId`,
      ].join('\n'),
      params: { nodeId: op.nodeId, newParentId: op.newParentId },
    }
  }

  compileMoveOrphan(op: MoveNodeOp): CompiledMutation {
    const edge = sanitize(op.edgeType)
    return {
      query: [
        `MATCH (n {id: $nodeId})`,
        `WHERE NOT (n)-[:${edge}]->()`,
        `MATCH (newParent {id: $newParentId})`,
        `CREATE (n)-[:${edge}]->(newParent)`,
        `RETURN n.id as nodeId, null as previousParentId, newParent.id as newParentId`,
      ].join('\n'),
      params: { nodeId: op.nodeId, newParentId: op.newParentId },
    }
  }

  compileGetSubtree(rootId: string, edgeType: string): CompiledMutation {
    const edge = sanitize(edgeType)
    return {
      query: [
        `MATCH path = (root {id: $rootId})<-[:${edge}*0..]-(descendant)`,
        `WITH descendant, length(path) as depth, labels(descendant) as nodeLabels`,
        `RETURN descendant as node, depth, nodeLabels`,
        `ORDER BY depth`,
      ].join('\n'),
      params: { rootId },
    }
  }

  // ---------------------------------------------------------------------------
  // Multi-op compilation (WITH chaining + parameter namespacing)
  // ---------------------------------------------------------------------------

  private compileMulti(ops: MutationOp[], schema: SchemaShape): CompiledMutation {
    const clauses: string[] = []
    const params: Record<string, unknown> = {}
    const carryVars: string[] = []

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]!
      const prefix = `op${i}_`
      const compiled = this.compileOne(op, schema)

      // Namespace all params with prefix
      for (const [key, value] of Object.entries(compiled.params)) {
        params[`${prefix}${key}`] = value
      }

      // Replace $param references with $opN_param in the query
      let query = compiled.query
      for (const key of Object.keys(compiled.params)) {
        query = query.replace(new RegExp(`\\$${key}\\b`, 'g'), `$${prefix}${key}`)
      }

      // Strip the RETURN clause (only last op returns)
      const returnIdx = query.lastIndexOf('\nRETURN ')
      const queryWithoutReturn = returnIdx >= 0 ? query.slice(0, returnIdx) : query

      // Extract variable names introduced by this op for WITH carry-over
      const newVars = extractIntroducedVars(queryWithoutReturn)

      if (i > 0 && carryVars.length > 0) {
        clauses.push(`WITH ${carryVars.join(', ')}`)
      }

      clauses.push(queryWithoutReturn)
      carryVars.push(...newVars)
    }

    // Add final RETURN from the last op
    const lastCompiled = this.compileOne(ops[ops.length - 1]!, schema)
    const lastReturn = extractReturnClause(lastCompiled.query)
    if (lastReturn) {
      // Namespace the return clause params too
      const prefix = `op${ops.length - 1}_`
      let returnClause = lastReturn
      for (const key of Object.keys(lastCompiled.params)) {
        returnClause = returnClause.replace(new RegExp(`\\$${key}\\b`, 'g'), `$${prefix}${key}`)
      }
      clauses.push(returnClause)
    }

    return { query: clauses.join('\n'), params }
  }

  // ---------------------------------------------------------------------------
  // Node compilation
  // ---------------------------------------------------------------------------

  private compileCreateNode(op: CreateNodeOp, schema: SchemaShape): CompiledMutation {
    const labels = this.resolveLabels(op.label, schema, op.additionalLabels as string[])
    const lines: string[] = []
    const params: Record<string, unknown> = { id: op.id, props: op.data }

    // MATCH link targets first
    if (op.links?.length) {
      let targetIdx = 0
      for (const link of op.links) {
        const alias = `t${targetIdx++}`
        lines.push(`MATCH (${alias} {id: $${alias}Id})`)
        params[`${alias}Id`] = link.targetId
      }
    }

    lines.push(`CREATE (n${formatLabels(labels)})`)
    lines.push(`SET n = $props, n.id = $id`)

    // CREATE link edges
    if (op.links?.length) {
      let targetIdx = 0
      for (const link of op.links) {
        const alias = `t${targetIdx++}`
        const edgeType = sanitize(link.edgeType)
        lines.push(`CREATE (n)-[:${edgeType}]->(${alias})`)
      }
    }

    lines.push(`RETURN n`)
    return { query: lines.join('\n'), params: buildParams(params) }
  }

  private compileUpdateNode(op: UpdateNodeOp, schema: SchemaShape): CompiledMutation {
    const labels = this.resolveLabels(op.label, schema)
    return {
      query: [`MATCH (n${formatLabels(labels)} {id: $id})`, `SET n += $props`, `RETURN n`].join(
        '\n',
      ),
      params: { id: op.id, props: op.data },
    }
  }

  private compileDeleteNode(op: DeleteNodeOp, schema: SchemaShape): CompiledMutation {
    const labels = this.resolveLabels(op.label, schema)
    if (op.detach) {
      return {
        query: [
          `MATCH (n${formatLabels(labels)} {id: $id})`,
          `DETACH DELETE n`,
          `RETURN count(n) > 0 as deleted`,
        ].join('\n'),
        params: { id: op.id },
      }
    }
    return {
      query: [
        `MATCH (n${formatLabels(labels)} {id: $id})`,
        `OPTIONAL MATCH (n)-[r]-()`,
        `WITH n, count(r) as relCount`,
        `WHERE relCount = 0`,
        `DELETE n`,
        `RETURN true as deleted, relCount`,
      ].join('\n'),
      params: { id: op.id },
    }
  }

  private compileUpsertNode(op: UpsertNodeOp, schema: SchemaShape): CompiledMutation {
    const labels = this.resolveLabels(op.label, schema)
    const lines: string[] = [
      `MERGE (n${formatLabels(labels)} {id: $id})`,
      `ON CREATE SET n = $createProps, n.id = $id`,
      `ON MATCH SET n += $updateProps`,
    ]
    const params: Record<string, unknown> = {
      id: op.id,
      createProps: op.data,
      updateProps: op.data,
    }

    // MERGE idempotent links (for InstanceModelPass instanceOf)
    if (op.links?.length) {
      lines.push(`WITH n`)
      let targetIdx = 0
      for (const link of op.links) {
        const alias = `t${targetIdx++}`
        const edgeType = sanitize(link.edgeType)
        lines.push(`MATCH (${alias} {id: $${alias}Id})`)
        lines.push(`MERGE (n)-[:${edgeType}]->(${alias})`)
        params[`${alias}Id`] = link.targetId
      }
    }

    lines.push(`RETURN n,`, `  CASE WHEN n.createdAt IS NULL THEN true ELSE false END as created`)
    return { query: lines.join('\n'), params: buildParams(params) }
  }

  private compileCloneNode(op: CloneNodeOp, schema: SchemaShape): CompiledMutation {
    const labels = this.resolveLabels(op.label, schema)
    const lines: string[] = []
    const params: Record<string, unknown> = {
      sourceId: op.sourceId,
      newId: op.newId,
      overrides: op.overrides,
    }

    // MATCH link targets first (e.g., instance_of class node)
    if (op.links?.length) {
      let targetIdx = 0
      for (const link of op.links) {
        const alias = `t${targetIdx++}`
        lines.push(`MATCH (${alias} {id: $${alias}Id})`)
        params[`${alias}Id`] = link.targetId
      }
    }

    if (op.parent && 'parentId' in op.parent) {
      const edgeType = sanitize(op.parent.edgeType)
      params.parentId = op.parent.parentId
      lines.push(`MATCH (source${formatLabels(labels)} {id: $sourceId})`)
      lines.push(`MATCH (parent {id: $parentId})`)
      lines.push(`CREATE (clone${formatLabels(labels)})`)
      lines.push(`SET clone = properties(source), clone.id = $newId, clone += $overrides`)
      lines.push(`CREATE (clone)-[:${edgeType}]->(parent)`)
    } else if (op.parent && 'preserve' in op.parent) {
      const edgeType = sanitize(op.parent.edgeType)
      lines.push(`MATCH (source${formatLabels(labels)} {id: $sourceId})-[:${edgeType}]->(parent)`)
      lines.push(`CREATE (clone${formatLabels(labels)})`)
      lines.push(`SET clone = properties(source), clone.id = $newId, clone += $overrides`)
      lines.push(`CREATE (clone)-[:${edgeType}]->(parent)`)
    } else {
      lines.push(`MATCH (source${formatLabels(labels)} {id: $sourceId})`)
      lines.push(`CREATE (clone${formatLabels(labels)})`)
      lines.push(`SET clone = properties(source), clone.id = $newId, clone += $overrides`)
    }

    // CREATE link edges (e.g., instance_of)
    if (op.links?.length) {
      let targetIdx = 0
      for (const link of op.links) {
        const alias = `t${targetIdx++}`
        const edgeType = sanitize(link.edgeType)
        lines.push(`CREATE (clone)-[:${edgeType}]->(${alias})`)
      }
    }

    lines.push(`RETURN clone`)
    return { query: lines.join('\n'), params: buildParams(params) }
  }

  // ---------------------------------------------------------------------------
  // Edge compilation
  // ---------------------------------------------------------------------------

  private compileCreateEdge(op: CreateEdgeOp, schema: SchemaShape): CompiledMutation {
    const edge = sanitize(op.edgeType)
    const { fromLabels, toLabels } = this.resolveEdgeEndpoints(op.edgeType, schema)
    const hasData = op.data && Object.keys(op.data).length > 0

    if (hasData) {
      return {
        query: [
          `MATCH (a${formatLabels(fromLabels)} {id: $fromId}), (b${formatLabels(toLabels)} {id: $toId})`,
          `CREATE (a)-[r:${edge}]->(b)`,
          `SET r = $props, r.id = $edgeId`,
          `RETURN r, a.id as fromId, b.id as toId`,
        ].join('\n'),
        params: buildParams({
          fromId: op.fromId,
          toId: op.toId,
          edgeId: op.edgeId,
          props: op.data,
        }),
      }
    }

    return {
      query: [
        `MATCH (a${formatLabels(fromLabels)} {id: $fromId}), (b${formatLabels(toLabels)} {id: $toId})`,
        `CREATE (a)-[r:${edge} {id: $edgeId}]->(b)`,
        `RETURN r, a.id as fromId, b.id as toId`,
      ].join('\n'),
      params: buildParams({ fromId: op.fromId, toId: op.toId, edgeId: op.edgeId }),
    }
  }

  private compileUpdateEdge(op: UpdateEdgeOp, schema: SchemaShape): CompiledMutation {
    const edge = sanitize(op.edgeType)
    const { fromLabels, toLabels } = this.resolveEdgeEndpoints(op.edgeType, schema)

    return {
      query: [
        `MATCH (a${formatLabels(fromLabels)} {id: $fromId})-[r:${edge}]->(b${formatLabels(toLabels)} {id: $toId})`,
        `SET r += $props`,
        `RETURN r, a.id as fromId, b.id as toId`,
      ].join('\n'),
      params: { fromId: op.fromId, toId: op.toId, props: op.data },
    }
  }

  private compileUpdateEdgeById(op: UpdateEdgeByIdOp): CompiledMutation {
    const edge = sanitize(op.edgeType)
    return {
      query: [
        `MATCH (a)-[r:${edge} {id: $edgeId}]->(b)`,
        `SET r += $props`,
        `RETURN r, a.id as fromId, b.id as toId`,
      ].join('\n'),
      params: { edgeId: op.edgeId, props: op.data },
    }
  }

  private compileDeleteEdge(op: DeleteEdgeOp, schema: SchemaShape): CompiledMutation {
    const edge = sanitize(op.edgeType)
    const { fromLabels, toLabels } = this.resolveEdgeEndpoints(op.edgeType, schema)

    return {
      query: [
        `MATCH (a${formatLabels(fromLabels)} {id: $fromId})-[r:${edge}]->(b${formatLabels(toLabels)} {id: $toId})`,
        `DELETE r`,
        `RETURN count(r) > 0 as deleted`,
      ].join('\n'),
      params: { fromId: op.fromId, toId: op.toId },
    }
  }

  private compileDeleteEdgeById(op: DeleteEdgeByIdOp): CompiledMutation {
    const edge = sanitize(op.edgeType)
    return {
      query: [
        `MATCH ()-[r:${edge} {id: $edgeId}]->()`,
        `DELETE r`,
        `RETURN count(r) > 0 as deleted`,
      ].join('\n'),
      params: { edgeId: op.edgeId },
    }
  }

  // ---------------------------------------------------------------------------
  // Hierarchy compilation
  // ---------------------------------------------------------------------------

  private compileDeleteSubtree(op: DeleteSubtreeOp): CompiledMutation {
    const edge = sanitize(op.edgeType)
    return {
      query: [
        `MATCH (root {id: $rootId})`,
        `CALL {`,
        `  WITH root`,
        `  MATCH (root)<-[:${edge}*0..]-(descendant)`,
        `  RETURN collect(distinct descendant) as nodes`,
        `}`,
        `WITH nodes`,
        `UNWIND nodes as n`,
        `DETACH DELETE n`,
        `RETURN size(nodes) as deletedNodes`,
      ].join('\n'),
      params: { rootId: op.rootId },
    }
  }

  // ---------------------------------------------------------------------------
  // Batch compilation
  // ---------------------------------------------------------------------------

  private compileBatchCreate(op: BatchCreateOp, schema: SchemaShape): CompiledMutation {
    const labels = this.resolveLabels(op.label, schema, op.additionalLabels as string[])
    const lines: string[] = []
    const params: Record<string, unknown> = { items: op.items }

    if (op.links?.length) {
      let targetIdx = 0
      for (const link of op.links) {
        const alias = `t${targetIdx++}`
        lines.push(`MATCH (${alias} {id: $${alias}Id})`)
        params[`${alias}Id`] = link.targetId
      }
    }

    lines.push(`UNWIND $items as item`)
    lines.push(`CREATE (n${formatLabels(labels)})`)
    lines.push(`SET n = item.props, n.id = item.id`)

    if (op.links?.length) {
      let targetIdx = 0
      for (const link of op.links) {
        const alias = `t${targetIdx++}`
        const edgeType = sanitize(link.edgeType)
        lines.push(`CREATE (n)-[:${edgeType}]->(${alias})`)
      }
    }

    lines.push(`RETURN n`)
    return { query: lines.join('\n'), params: buildParams(params) }
  }

  private compileBatchUpdate(op: BatchUpdateOp, schema: SchemaShape): CompiledMutation {
    const labels = this.resolveLabels(op.label, schema)
    return {
      query: [
        `UNWIND $updates as update`,
        `MATCH (n${formatLabels(labels)} {id: update.id})`,
        `SET n += update.props`,
        `RETURN n`,
      ].join('\n'),
      params: { updates: op.updates },
    }
  }

  private compileBatchDelete(op: BatchDeleteOp, schema: SchemaShape): CompiledMutation {
    const labels = this.resolveLabels(op.label, schema)
    return {
      query: [
        `UNWIND $ids as nodeId`,
        `MATCH (n${formatLabels(labels)} {id: nodeId})`,
        `DETACH DELETE n`,
        `RETURN count(n) as deletedCount`,
      ].join('\n'),
      params: { ids: op.ids },
    }
  }

  private compileBatchLink(op: BatchLinkOp, schema: SchemaShape): CompiledMutation {
    const edge = sanitize(op.edgeType)
    const { fromLabels, toLabels } = this.resolveEdgeEndpoints(op.edgeType, schema)

    return {
      query: [
        `UNWIND $links as link`,
        `MATCH (a${formatLabels(fromLabels)} {id: link.from}), (b${formatLabels(toLabels)} {id: link.to})`,
        `CREATE (a)-[r:${edge}]->(b)`,
        `SET r = coalesce(link.data, {}), r.id = link.id`,
        `RETURN r, a.id as fromId, b.id as toId`,
      ].join('\n'),
      params: { links: op.links },
    }
  }

  private compileBatchUnlink(op: BatchUnlinkOp, schema: SchemaShape): CompiledMutation {
    const edge = sanitize(op.edgeType)
    const { fromLabels, toLabels } = this.resolveEdgeEndpoints(op.edgeType, schema)

    return {
      query: [
        `UNWIND $links as link`,
        `MATCH (a${formatLabels(fromLabels)} {id: link.from})-[r:${edge}]->(b${formatLabels(toLabels)} {id: link.to})`,
        `DELETE r`,
        `RETURN count(r) as deleted`,
      ].join('\n'),
      params: { links: op.links },
    }
  }

  private compileUnlinkAllFrom(op: UnlinkAllFromOp, schema: SchemaShape): CompiledMutation {
    const edge = sanitize(op.edgeType)
    const { fromLabels } = this.resolveEdgeEndpoints(op.edgeType, schema)

    return {
      query: [
        `MATCH (a${formatLabels(fromLabels)} {id: $from})-[r:${edge}]->()`,
        `DELETE r`,
        `RETURN count(r) as deleted`,
      ].join('\n'),
      params: { from: op.fromId },
    }
  }

  private compileUnlinkAllTo(op: UnlinkAllToOp, schema: SchemaShape): CompiledMutation {
    const edge = sanitize(op.edgeType)
    const { toLabels } = this.resolveEdgeEndpoints(op.edgeType, schema)

    return {
      query: [
        `MATCH ()-[r:${edge}]->(b${formatLabels(toLabels)} {id: $to})`,
        `DELETE r`,
        `RETURN count(r) as deleted`,
      ].join('\n'),
      params: { to: op.toId },
    }
  }

  // ---------------------------------------------------------------------------
  // Link-Node Operations (emitted by ReifyEdgesMutationPass)
  // ---------------------------------------------------------------------------

  private compileBatchCreateLinkNode(op: BatchCreateLinkNodeOp): CompiledMutation {
    const linkLabel = sanitize(op.linkLabel)
    const lines: string[] = []
    const params: Record<string, unknown> = {
      items: op.items.map((item) => ({
        id: item.id,
        from: item.fromId,
        to: item.toId,
        data: item.data ?? {},
      })),
    }

    // If IM pass added instance_of links, MATCH the class node
    if (op.links?.length) {
      for (let i = 0; i < op.links.length; i++) {
        lines.push(`MATCH (linkCls${i} {id: $linkClsId${i}})`)
        params[`linkClsId${i}`] = op.links[i]!.targetId
      }
    }

    lines.push(`UNWIND $items as item`)
    lines.push(
      `MATCH (a${formatLabels(op.fromLabels)} {id: item.from}), (b${formatLabels(op.toLabels)} {id: item.to})`,
    )
    lines.push(`CREATE (linkNode:${linkLabel})`)
    lines.push(`SET linkNode = item.data, linkNode.id = item.id`)
    lines.push(`CREATE (a)-[:has_link]->(linkNode)`)
    lines.push(`CREATE (linkNode)-[:links_to]->(b)`)

    // Emit instance_of (or any other inline links)
    if (op.links?.length) {
      for (let i = 0; i < op.links.length; i++) {
        const edgeType = sanitize(op.links[i]!.edgeType)
        lines.push(`CREATE (linkNode)-[:${edgeType}]->(linkCls${i})`)
      }
    }

    lines.push(`RETURN linkNode as r, a.id as fromId, b.id as toId`)
    return { query: lines.join('\n'), params: buildParams(params) }
  }

  private compileBatchDeleteLinkNode(op: BatchDeleteLinkNodeOp): CompiledMutation {
    const linkLabel = sanitize(op.linkLabel)
    return {
      query: [
        `UNWIND $links as link`,
        `MATCH (a${formatLabels(op.fromLabels)} {id: link.from})-[:has_link]->(linkNode:${linkLabel})-[:links_to]->(b${formatLabels(op.toLabels)} {id: link.to})`,
        `DETACH DELETE linkNode`,
        `RETURN count(linkNode) as deleted`,
      ].join('\n'),
      params: { links: op.links },
    }
  }

  private compileUpdateLinkNode(op: UpdateLinkNodeOp): CompiledMutation {
    const linkLabel = sanitize(op.linkLabel)
    return {
      query: [
        `MATCH (a${formatLabels(op.fromLabels)} {id: $from})-[:has_link]->(linkNode:${linkLabel})-[:links_to]->(b${formatLabels(op.toLabels)} {id: $to})`,
        `SET linkNode += $data`,
        `RETURN linkNode`,
      ].join('\n'),
      params: buildParams({ from: op.fromId, to: op.toId, data: op.data }),
    }
  }

  private compileDeleteLinkNode(op: DeleteLinkNodeOp): CompiledMutation {
    const linkLabel = sanitize(op.linkLabel)
    return {
      query: [
        `MATCH (a${formatLabels(op.fromLabels)} {id: $from})-[:has_link]->(linkNode:${linkLabel})-[:links_to]->(b${formatLabels(op.toLabels)} {id: $to})`,
        `DETACH DELETE linkNode`,
        `RETURN count(linkNode) as deleted`,
      ].join('\n'),
      params: { from: op.fromId, to: op.toId },
    }
  }

  private compileDeleteLinkNodesFrom(op: DeleteLinkNodesFromOp): CompiledMutation {
    const linkLabel = sanitize(op.linkLabel)
    return {
      query: [
        `MATCH (a${formatLabels(op.fromLabels)} {id: $from})-[:has_link]->(linkNode:${linkLabel})`,
        `DETACH DELETE linkNode`,
        `RETURN count(linkNode) as deleted`,
      ].join('\n'),
      params: { from: op.fromId },
    }
  }

  private compileDeleteLinkNodesTo(op: DeleteLinkNodesToOp): CompiledMutation {
    const linkLabel = sanitize(op.linkLabel)
    return {
      query: [
        `MATCH (linkNode:${linkLabel})-[:links_to]->(b${formatLabels(op.toLabels)} {id: $to})`,
        `DETACH DELETE linkNode`,
        `RETURN count(linkNode) as deleted`,
      ].join('\n'),
      params: { to: op.toId },
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private resolveLabels(label: string, schema: SchemaShape, additionalLabels?: string[]): string[] {
    const labels = resolveNodeLabels(schema, label).map((l) => sanitize(l))
    if (additionalLabels?.length) {
      labels.push(...additionalLabels.map((l) => sanitize(l)))
    }
    return labels
  }

  private resolveEdgeEndpoints(
    edgeType: string,
    schema: SchemaShape,
  ): { fromLabels: string[]; toLabels: string[] } {
    // When instance model is enabled, all instances are :Node
    if (schema.classRefs) {
      return { fromLabels: ['Node'], toLabels: ['Node'] }
    }
    const fromTypes = edgeFrom(schema, edgeType)
    const toTypes = edgeTo(schema, edgeType)
    const fromLabels = fromTypes[0]
      ? resolveNodeLabels(schema, fromTypes[0]).map((l) => sanitize(l))
      : []
    const toLabels = toTypes[0] ? resolveNodeLabels(schema, toTypes[0]).map((l) => sanitize(l)) : []
    return { fromLabels, toLabels }
  }
}

// =============================================================================
// UTILITIES
// =============================================================================

function sanitize(identifier: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid identifier: ${identifier}`)
  }
  return identifier
}

function buildParams(params: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      filtered[key] = value
    }
  }
  return filtered
}

/** Extract variable names introduced by CREATE/MERGE clauses (e.g., n, clone, r) */
function extractIntroducedVars(query: string): string[] {
  const vars: string[] = []
  // CREATE (varName... or CREATE (varName)
  const createPattern = /CREATE\s+\((\w+)/g
  let match: RegExpExecArray | null
  while ((match = createPattern.exec(query)) !== null) {
    if (match[1] && !vars.includes(match[1])) vars.push(match[1])
  }
  // CREATE (a)-[r:...]->(b) — edge vars
  const edgePattern = /CREATE\s+\(\w+\)-\[(\w+)/g
  while ((match = edgePattern.exec(query)) !== null) {
    if (match[1] && !vars.includes(match[1])) vars.push(match[1])
  }
  // MATCH vars that may need carry-over
  const matchPattern = /MATCH\s+\((\w+)/g
  while ((match = matchPattern.exec(query)) !== null) {
    if (match[1] && !vars.includes(match[1])) vars.push(match[1])
  }
  return vars
}

/** Extract the RETURN clause from a query string. */
function extractReturnClause(query: string): string | null {
  const idx = query.lastIndexOf('\nRETURN ')
  if (idx >= 0) return query.slice(idx + 1)
  if (query.startsWith('RETURN ')) return query
  return null
}
