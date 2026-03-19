/**
 * ReifyEdgesMutationPass — Edge Reification for Mutations
 *
 * Converts edge MutationOps into link-node op types when the edge is reified.
 * Purely structural — knows nothing about the instance model.
 *
 * Runs BEFORE InstanceOfMutationPass in the mutation pipeline.
 * The IM pass then handles relabeling and instance_of on the resulting link-node ops.
 */

import type { MutationCompilationPass } from '../ast/pipeline'
import type {
  MutationOp,
  CreateEdgeOp,
  UpdateEdgeByIdOp,
  DeleteEdgeByIdOp,
  BatchLinkOp,
  BatchUnlinkOp,
  UpdateEdgeOp,
  DeleteEdgeOp,
  UnlinkAllFromOp,
  UnlinkAllToOp,
} from '../ast/types'
import type { SchemaShape } from '../../schema'
import { STRUCTURAL_EDGE_SET } from '../../schema'
import { isReified, resolveNodeLabels, edgeFrom, edgeTo } from '../../helpers'

export class ReifyEdgesMutationPass implements MutationCompilationPass {
  readonly name = 'ReifyEdgesMutation'

  transform(op: MutationOp, schema: SchemaShape): MutationOp | MutationOp[] {
    switch (op.type) {
      case 'createEdge':
        return this.transformCreateEdge(op, schema)
      case 'updateEdge':
        return this.transformUpdateEdge(op, schema)
      case 'updateEdgeById':
        return this.transformUpdateEdgeById(op, schema)
      case 'deleteEdge':
        return this.transformDeleteEdge(op, schema)
      case 'deleteEdgeById':
        return this.transformDeleteEdgeById(op, schema)
      case 'batchLink':
        return this.transformBatchLink(op, schema)
      case 'batchUnlink':
        return this.transformBatchUnlink(op, schema)
      case 'unlinkAllFrom':
        return this.transformUnlinkAllFrom(op, schema)
      case 'unlinkAllTo':
        return this.transformUnlinkAllTo(op, schema)
      default:
        return op
    }
  }

  // ---------------------------------------------------------------------------
  // CreateEdgeOp → BatchCreateLinkNodeOp
  // ---------------------------------------------------------------------------

  private transformCreateEdge(op: CreateEdgeOp, schema: SchemaShape): MutationOp {
    if (!this.shouldReify(op.edgeType, schema)) return op

    const { linkLabel, fromLabels, toLabels } = this.resolveEndpoints(op.edgeType, schema)
    return {
      type: 'batchCreateLinkNode',
      edgeType: op.edgeType,
      linkLabel,
      fromLabels,
      toLabels,
      items: [
        {
          id: op.edgeId,
          fromId: op.fromId,
          toId: op.toId,
          data: op.data,
        },
      ],
    }
  }

  // ---------------------------------------------------------------------------
  // BatchLinkOp → BatchCreateLinkNodeOp
  // ---------------------------------------------------------------------------

  private transformBatchLink(op: BatchLinkOp, schema: SchemaShape): MutationOp {
    if (!this.shouldReify(op.edgeType, schema)) return op

    const { linkLabel, fromLabels, toLabels } = this.resolveEndpoints(op.edgeType, schema)
    return {
      type: 'batchCreateLinkNode',
      edgeType: op.edgeType,
      linkLabel,
      fromLabels,
      toLabels,
      items: op.links.map((link) => ({
        id: link.edgeId,
        fromId: link.fromId,
        toId: link.toId,
        data: link.data,
      })),
    }
  }

  // ---------------------------------------------------------------------------
  // BatchUnlinkOp → BatchDeleteLinkNodeOp
  // ---------------------------------------------------------------------------

  private transformBatchUnlink(op: BatchUnlinkOp, schema: SchemaShape): MutationOp {
    if (!this.shouldReify(op.edgeType, schema)) return op

    const { linkLabel, fromLabels, toLabels } = this.resolveEndpoints(op.edgeType, schema)
    return {
      type: 'batchDeleteLinkNode',
      linkLabel,
      fromLabels,
      toLabels,
      links: op.links,
    }
  }

  // ---------------------------------------------------------------------------
  // UpdateEdgeOp → UpdateLinkNodeOp
  // ---------------------------------------------------------------------------

  private transformUpdateEdge(op: UpdateEdgeOp, schema: SchemaShape): MutationOp {
    if (!this.shouldReify(op.edgeType, schema)) return op

    const { linkLabel, fromLabels, toLabels } = this.resolveEndpoints(op.edgeType, schema)
    return {
      type: 'updateLinkNode',
      linkLabel,
      fromLabels,
      toLabels,
      fromId: op.fromId,
      toId: op.toId,
      data: op.data,
    }
  }

  // ---------------------------------------------------------------------------
  // DeleteEdgeOp → DeleteLinkNodeOp
  // ---------------------------------------------------------------------------

  private transformDeleteEdge(op: DeleteEdgeOp, schema: SchemaShape): MutationOp {
    if (!this.shouldReify(op.edgeType, schema)) return op

    const { linkLabel, fromLabels, toLabels } = this.resolveEndpoints(op.edgeType, schema)
    return {
      type: 'deleteLinkNode',
      linkLabel,
      fromLabels,
      toLabels,
      fromId: op.fromId,
      toId: op.toId,
    }
  }

  // ---------------------------------------------------------------------------
  // UnlinkAllFromOp → DeleteLinkNodesFromOp
  // ---------------------------------------------------------------------------

  private transformUnlinkAllFrom(op: UnlinkAllFromOp, schema: SchemaShape): MutationOp {
    if (!this.shouldReify(op.edgeType, schema)) return op

    const { linkLabel, fromLabels } = this.resolveEndpoints(op.edgeType, schema)
    return {
      type: 'deleteLinkNodesFrom',
      linkLabel,
      fromLabels,
      fromId: op.fromId,
    }
  }

  // ---------------------------------------------------------------------------
  // UnlinkAllToOp → DeleteLinkNodesToOp
  // ---------------------------------------------------------------------------

  private transformUnlinkAllTo(op: UnlinkAllToOp, schema: SchemaShape): MutationOp {
    if (!this.shouldReify(op.edgeType, schema)) return op

    const { linkLabel, toLabels } = this.resolveEndpoints(op.edgeType, schema)
    return {
      type: 'deleteLinkNodesTo',
      linkLabel,
      toLabels,
      toId: op.toId,
    }
  }

  // ---------------------------------------------------------------------------
  // ByIdOps → node ops (reified "edge" is actually a node)
  // ---------------------------------------------------------------------------

  private transformUpdateEdgeById(op: UpdateEdgeByIdOp, schema: SchemaShape): MutationOp {
    if (!this.shouldReify(op.edgeType, schema)) return op

    const linkLabel = this.resolveLinkLabel(op.edgeType)
    return {
      type: 'updateNode',
      label: linkLabel,
      id: op.edgeId,
      data: op.data,
    }
  }

  private transformDeleteEdgeById(op: DeleteEdgeByIdOp, schema: SchemaShape): MutationOp {
    if (!this.shouldReify(op.edgeType, schema)) return op

    const linkLabel = this.resolveLinkLabel(op.edgeType)
    return {
      type: 'deleteNode',
      label: linkLabel,
      id: op.edgeId,
      detach: true,
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private shouldReify(edgeType: string, schema: SchemaShape): boolean {
    if (STRUCTURAL_EDGE_SET.has(edgeType)) return false
    return isReified(schema, edgeType)
  }

  /** Resolve link label + endpoint labels from schema. No IM knowledge. */
  private resolveEndpoints(
    edgeType: string,
    schema: SchemaShape,
  ): { linkLabel: string; fromLabels: string[]; toLabels: string[] } {
    const linkLabel = this.resolveLinkLabel(edgeType)
    const fromTypes = edgeFrom(schema, edgeType)
    const toTypes = edgeTo(schema, edgeType)
    const fromLabels = fromTypes[0] ? resolveNodeLabels(schema, fromTypes[0]) : []
    const toLabels = toTypes[0] ? resolveNodeLabels(schema, toTypes[0]) : []
    return { linkLabel, fromLabels, toLabels }
  }

  /** PascalCase the edge type to get the link label. IM pass may overwrite to 'Link'. */
  private resolveLinkLabel(edgeType: string): string {
    return edgeType.charAt(0).toUpperCase() + edgeType.slice(1)
  }
}
