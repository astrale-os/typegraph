/**
 * ReifyEdgesMutationPass — Edge Reification for Mutations
 *
 * Annotates edge MutationOps with `reified` metadata when the edge type
 * is reified in the schema. The mutation compiler uses these annotations
 * to generate link-node patterns instead of direct relationships.
 *
 * Also converts CreateEdgeOp → BatchLinkOp and
 * UpdateEdgeByIdOp → UpdateNodeOp / DeleteEdgeByIdOp → DeleteNodeOp
 * for reified edges, since the "edge" is actually a node.
 *
 * Runs after InstanceModelMutationPass in the mutation pipeline.
 */

import type { MutationCompilationPass } from '../../mutation/ast/pipeline'
import type {
  MutationOp,
  ReifiedAnnotation,
  CreateEdgeOp,
  UpdateEdgeByIdOp,
  DeleteEdgeByIdOp,
} from '../../mutation/ast/types'
import type { SchemaShape, InstanceModelConfig } from '../../schema'
import { isReified } from '../../helpers'
import { STRUCTURAL_EDGE_SET, META_LABELS } from './structural-edges'

export class ReifyEdgesMutationPass implements MutationCompilationPass {
  readonly name = 'ReifyEdgesMutation'

  transform(op: MutationOp, schema: SchemaShape): MutationOp | MutationOp[] {
    switch (op.type) {
      case 'createEdge':
        return this.transformCreateEdge(op, schema)
      case 'updateEdge':
        if (this.shouldReify(op.edgeType, schema)) {
          return { ...op, reified: this.buildAnnotation(op.edgeType, schema) }
        }
        return op
      case 'updateEdgeById':
        return this.transformUpdateEdgeById(op, schema)
      case 'deleteEdge':
        if (this.shouldReify(op.edgeType, schema)) {
          return { ...op, reified: this.buildAnnotation(op.edgeType, schema) }
        }
        return op
      case 'deleteEdgeById':
        return this.transformDeleteEdgeById(op, schema)
      case 'batchLink':
        if (this.shouldReify(op.edgeType, schema)) {
          return { ...op, reified: this.buildAnnotation(op.edgeType, schema) }
        }
        return op
      case 'batchUnlink':
        if (this.shouldReify(op.edgeType, schema)) {
          return { ...op, reified: this.buildAnnotation(op.edgeType, schema) }
        }
        return op
      case 'unlinkAllFrom':
        if (this.shouldReify(op.edgeType, schema)) {
          return { ...op, reified: this.buildAnnotation(op.edgeType, schema) }
        }
        return op
      case 'unlinkAllTo':
        if (this.shouldReify(op.edgeType, schema)) {
          return { ...op, reified: this.buildAnnotation(op.edgeType, schema) }
        }
        return op
      default:
        return op
    }
  }

  // ---------------------------------------------------------------------------
  // CreateEdgeOp → BatchLinkOp conversion
  // ---------------------------------------------------------------------------

  private transformCreateEdge(op: CreateEdgeOp, schema: SchemaShape): MutationOp {
    if (!this.shouldReify(op.edgeType, schema)) return op

    // Convert to BatchLinkOp with a single item + reified annotation
    return {
      type: 'batchLink',
      edgeType: op.edgeType,
      links: [{
        fromId: op.fromId,
        toId: op.toId,
        edgeId: op.edgeId,
        data: op.data,
      }],
      reified: this.buildAnnotation(op.edgeType, schema),
    }
  }

  // ---------------------------------------------------------------------------
  // ByIdOps → node ops (reified "edge" is actually a node)
  // ---------------------------------------------------------------------------

  private transformUpdateEdgeById(op: UpdateEdgeByIdOp, schema: SchemaShape): MutationOp {
    if (!this.shouldReify(op.edgeType, schema)) return op

    const linkLabel = this.resolveLinkLabel(op.edgeType, schema.instanceModel)
    return {
      type: 'updateNode',
      label: linkLabel,
      id: op.edgeId,
      data: op.data,
    }
  }

  private transformDeleteEdgeById(op: DeleteEdgeByIdOp, schema: SchemaShape): MutationOp {
    if (!this.shouldReify(op.edgeType, schema)) return op

    const linkLabel = this.resolveLinkLabel(op.edgeType, schema.instanceModel)
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

  private buildAnnotation(edgeType: string, schema: SchemaShape): ReifiedAnnotation {
    const linkLabel = this.resolveLinkLabel(edgeType, schema.instanceModel)
    const instanceOfTargetId = schema.instanceModel?.enabled
      ? schema.instanceModel.refs[edgeType]
      : undefined

    return { linkLabel, instanceOfTargetId }
  }

  private resolveLinkLabel(edgeType: string, instanceModel: InstanceModelConfig | undefined): string {
    if (instanceModel?.enabled) {
      return META_LABELS.LINK
    }
    // Without instance model, use capitalize-first to preserve camelCase
    return edgeType.charAt(0).toUpperCase() + edgeType.slice(1)
  }
}
