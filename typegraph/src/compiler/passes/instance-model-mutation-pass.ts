/**
 * InstanceModelMutationPass — Type-Instance Lowering for Mutations
 *
 * Transforms MutationOps to use the physical instance model:
 * - Node labels become 'Node'
 * - Create/Upsert/Clone ops get instance_of links to class nodes
 * - Update/Delete ops only need label relabeling (ID match is sufficient)
 *
 * Runs before ReifyEdgesMutationPass in the mutation pipeline.
 */

import type { MutationCompilationPass } from '../../mutation/ast/pipeline'
import type { MutationOp, InlineLink } from '../../mutation/ast/types'
import type { SchemaShape, InstanceModelConfig } from '../../schema'
import { STRUCTURAL_EDGES, META_LABELS } from './structural-edges'

export class InstanceModelMutationPass implements MutationCompilationPass {
  readonly name = 'InstanceModelMutation'

  private config: InstanceModelConfig

  constructor(config: InstanceModelConfig) {
    this.config = config
  }

  transform(op: MutationOp, _schema: SchemaShape): MutationOp | MutationOp[] {
    if (!this.config.enabled) return op

    switch (op.type) {
      case 'createNode':
        return {
          ...op,
          label: META_LABELS.NODE,
          links: this.mergeLinks(op.links, op.label),
        }

      case 'upsertNode':
        return {
          ...op,
          label: META_LABELS.NODE,
          links: this.mergeLinks(op.links, op.label),
        }

      case 'updateNode':
        return { ...op, label: META_LABELS.NODE }

      case 'deleteNode':
        return { ...op, label: META_LABELS.NODE }

      case 'cloneNode':
        return {
          ...op,
          label: META_LABELS.NODE,
          links: this.mergeLinks(op.links, op.label),
        }

      case 'batchCreate':
        return {
          ...op,
          label: META_LABELS.NODE,
          links: this.mergeLinks(op.links, op.label),
        }

      case 'batchUpdate':
        return { ...op, label: META_LABELS.NODE }

      case 'batchDelete':
        return { ...op, label: META_LABELS.NODE }

      // Edge ops, hierarchy ops — untouched by this pass.
      // Edge endpoint labels are resolved by the mutation compiler.
      default:
        return op
    }
  }

  /**
   * Merge existing inline links with the instance_of link to the class node.
   */
  private mergeLinks(
    existing: readonly InlineLink[] | undefined,
    originalLabel: string,
  ): readonly InlineLink[] {
    const classId = this.config.refs[originalLabel]
    if (!classId) {
      throw new Error(
        `InstanceModelMutationPass: no class ref found for type '${originalLabel}'`,
      )
    }

    const instanceOfLink: InlineLink = {
      edgeType: STRUCTURAL_EDGES.INSTANCE_OF,
      targetId: classId,
    }

    return existing ? [...existing, instanceOfLink] : [instanceOfLink]
  }
}
