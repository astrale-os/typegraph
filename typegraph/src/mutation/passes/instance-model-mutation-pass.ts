/**
 * InstanceModelMutationPass — Type-Instance Lowering for Mutations
 *
 * Transforms MutationOps to use the physical instance model:
 * - Node labels become 'Node'
 * - Link labels become 'Link'
 * - Create/Upsert/Clone ops get instance_of links to class nodes
 * - BatchCreateLinkNode ops get instance_of links + relabeled endpoints
 * - Update/Delete ops only need label relabeling (ID match is sufficient)
 *
 * Runs AFTER ReifyEdgesMutationPass in the mutation pipeline.
 */

import type { MutationCompilationPass } from '../ast/pipeline'
import type { MutationOp, InlineLink } from '../ast/types'
import type { SchemaShape, InstanceModelConfig } from '../../schema'
import { STRUCTURAL_EDGES, META_LABELS } from '../../schema'

export class InstanceModelMutationPass implements MutationCompilationPass {
  readonly name = 'InstanceModelMutation'

  private config: InstanceModelConfig

  constructor(config: InstanceModelConfig) {
    this.config = config
  }

  transform(op: MutationOp, _schema: SchemaShape): MutationOp | MutationOp[] {
    if (!this.config.enabled) return op

    switch (op.type) {
      // --- Regular node ops (existing behavior) ---

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

      // --- Link-node ops (from ReifyEdgesMutationPass) ---

      case 'batchCreateLinkNode':
        return {
          ...op,
          linkLabel: META_LABELS.LINK,
          fromLabels: [META_LABELS.NODE],
          toLabels: [META_LABELS.NODE],
          links: this.mergeLinks(op.links, op.edgeType),
        }

      case 'batchDeleteLinkNode':
        return {
          ...op,
          linkLabel: META_LABELS.LINK,
          fromLabels: [META_LABELS.NODE],
          toLabels: [META_LABELS.NODE],
        }

      case 'updateLinkNode':
        return {
          ...op,
          linkLabel: META_LABELS.LINK,
          fromLabels: [META_LABELS.NODE],
          toLabels: [META_LABELS.NODE],
        }

      case 'deleteLinkNode':
        return {
          ...op,
          linkLabel: META_LABELS.LINK,
          fromLabels: [META_LABELS.NODE],
          toLabels: [META_LABELS.NODE],
        }

      case 'deleteLinkNodesFrom':
        return {
          ...op,
          linkLabel: META_LABELS.LINK,
          fromLabels: [META_LABELS.NODE],
        }

      case 'deleteLinkNodesTo':
        return {
          ...op,
          linkLabel: META_LABELS.LINK,
          toLabels: [META_LABELS.NODE],
        }

      // Edge ops, hierarchy ops — untouched by this pass.
      // Edge endpoint labels are resolved by the mutation compiler.
      default:
        return op
    }
  }

  /**
   * Merge existing inline links with the instance_of link to the class node.
   * Works for both node types (using label) and link-node types (using edgeType).
   */
  private mergeLinks(
    existing: readonly InlineLink[] | undefined,
    typeKey: string,
  ): readonly InlineLink[] {
    const classId = this.config.refs[typeKey]
    if (!classId) {
      throw new Error(
        `InstanceModelMutationPass: no class ref found for type '${typeKey}'`,
      )
    }

    const instanceOfLink: InlineLink = {
      edgeType: STRUCTURAL_EDGES.INSTANCE_OF,
      targetId: classId,
    }

    return existing ? [...existing, instanceOfLink] : [instanceOfLink]
  }
}
