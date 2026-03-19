/**
 * InstanceOfMutationPass — Type-Instance Lowering for Mutations
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
import type { SchemaShape } from '../../schema'
import { STRUCTURAL_EDGES, META_LABELS } from '../../schema'

export class InstanceOfMutationPass implements MutationCompilationPass {
  readonly name = 'InstanceOfMutation'

  transform(op: MutationOp, schema: SchemaShape): MutationOp | MutationOp[] {
    if (!schema.classRefs) return op

    switch (op.type) {
      case 'createNode':
        return {
          ...op,
          label: META_LABELS.NODE,
          links: mergeLinks(schema, op.links, op.label),
        }

      case 'upsertNode':
        return {
          ...op,
          label: META_LABELS.NODE,
          links: mergeLinks(schema, op.links, op.label),
        }

      case 'updateNode':
        return { ...op, label: META_LABELS.NODE }

      case 'deleteNode':
        return { ...op, label: META_LABELS.NODE }

      case 'cloneNode':
        return {
          ...op,
          label: META_LABELS.NODE,
          links: mergeLinks(schema, op.links, op.label),
        }

      case 'batchCreate':
        return {
          ...op,
          label: META_LABELS.NODE,
          links: mergeLinks(schema, op.links, op.label),
        }

      case 'batchUpdate':
        return { ...op, label: META_LABELS.NODE }

      case 'batchDelete':
        return { ...op, label: META_LABELS.NODE }

      case 'batchCreateLinkNode':
        return {
          ...op,
          linkLabel: META_LABELS.LINK,
          fromLabels: [META_LABELS.NODE],
          toLabels: [META_LABELS.NODE],
          links: mergeLinks(schema, op.links, op.edgeType),
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

      default:
        return op
    }
  }
}

function mergeLinks(
  schema: SchemaShape,
  existing: readonly InlineLink[] | undefined,
  typeKey: string,
): readonly InlineLink[] {
  const classId = schema.classRefs![typeKey]
  if (!classId) {
    throw new Error(`InstanceOfMutationPass: no class ref found for type '${typeKey}'`)
  }

  const instanceOfLink: InlineLink = {
    edgeType: STRUCTURAL_EDGES.INSTANCE_OF,
    targetId: classId,
  }

  return existing ? [...existing, instanceOfLink] : [instanceOfLink]
}
