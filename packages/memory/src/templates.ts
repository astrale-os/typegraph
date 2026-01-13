/**
 * In-Memory Mutation Template Provider
 *
 * Instead of generating Cypher strings, this provider generates
 * JSON command strings that our InMemoryDriver can execute directly.
 */

import type {
  MutationTemplateProvider,
  NodeTemplateProvider,
  EdgeTemplateProvider,
  HierarchyTemplateProvider,
  BatchTemplateProvider,
  TemplateUtils,
} from '@astrale/typegraph'

/**
 * Create a command string for our in-memory driver.
 */
function cmd(
  type: string,
  label?: string,
  edgeType?: string,
  extra?: Record<string, unknown>,
): string {
  return `INMEM:${JSON.stringify({ type, label, edgeType, params: {}, ...extra })}`
}

/**
 * Node template provider for in-memory operations.
 */
class InMemoryNodeTemplates implements NodeTemplateProvider {
  create(label: string): string {
    return cmd('createNode', label)
  }

  update(label: string): string {
    return cmd('updateNode', label)
  }

  delete(label: string): string {
    return cmd('deleteNode', label)
  }

  deleteKeepEdges(label: string): string {
    // In-memory doesn't have a separate "keep edges" mode
    // The driver handles this in the delete logic if needed
    return cmd('deleteNode', label, undefined, { keepEdges: true })
  }

  getById(label: string): string {
    return cmd('query', label, undefined, { params: { operation: 'getById' } })
  }

  clone(label: string): string {
    return cmd('createNode', label, undefined, { clone: true })
  }

  upsert(label: string): string {
    return cmd('createNode', label, undefined, { upsert: true })
  }
}

/**
 * Edge template provider for in-memory operations.
 */
class InMemoryEdgeTemplates implements EdgeTemplateProvider {
  create(edgeType: string): string {
    return cmd('createEdge', undefined, edgeType)
  }

  createNoProps(edgeType: string): string {
    return cmd('createEdge', undefined, edgeType, { noProps: true })
  }

  update(edgeType: string): string {
    return cmd('updateEdge', undefined, edgeType)
  }

  deleteByEndpoints(edgeType: string): string {
    return cmd('deleteEdge', undefined, edgeType, { byEndpoints: true })
  }

  deleteById(edgeType: string): string {
    return cmd('deleteEdge', undefined, edgeType, { byId: true })
  }

  exists(edgeType: string): string {
    return cmd('query', undefined, edgeType, { params: { operation: 'edgeExists' } })
  }
}

/**
 * Hierarchy template provider for in-memory operations.
 */
class InMemoryHierarchyTemplates implements HierarchyTemplateProvider {
  createChild(nodeLabel: string, edgeType: string): string {
    return cmd('createNode', nodeLabel, edgeType, { hierarchy: 'createChild' })
  }

  move(edgeType: string): string {
    return cmd('updateEdge', undefined, edgeType, { hierarchy: 'move' })
  }

  moveOrphan(edgeType: string): string {
    return cmd('updateEdge', undefined, edgeType, { hierarchy: 'moveOrphan' })
  }

  getParent(edgeType: string): string {
    return cmd('query', undefined, edgeType, { params: { operation: 'getParent' } })
  }

  wouldCreateCycle(edgeType: string): string {
    return cmd('query', undefined, edgeType, { params: { operation: 'wouldCreateCycle' } })
  }

  deleteSubtree(edgeType: string): string {
    return cmd('deleteNode', undefined, edgeType, { hierarchy: 'deleteSubtree' })
  }

  getSubtree(edgeType: string): string {
    return cmd('query', undefined, edgeType, { params: { operation: 'getSubtree' } })
  }

  cloneWithParent(nodeLabel: string, edgeType: string): string {
    return cmd('createNode', nodeLabel, edgeType, { hierarchy: 'cloneWithParent' })
  }

  clonePreserveParent(nodeLabel: string, edgeType: string): string {
    return cmd('createNode', nodeLabel, edgeType, { hierarchy: 'clonePreserveParent' })
  }
}

/**
 * Batch template provider for in-memory operations.
 */
class InMemoryBatchTemplates implements BatchTemplateProvider {
  createMany(label: string): string {
    return cmd('createNode', label, undefined, { batch: true })
  }

  updateMany(label: string): string {
    return cmd('updateNode', label, undefined, { batch: true })
  }

  deleteMany(label: string): string {
    return cmd('deleteNode', label, undefined, { batch: true })
  }

  linkMany(edgeType: string): string {
    return cmd('createEdge', undefined, edgeType, { batch: true })
  }

  unlinkMany(edgeType: string): string {
    return cmd('deleteEdge', undefined, edgeType, { batch: true })
  }

  unlinkAllFrom(edgeType: string): string {
    return cmd('deleteEdge', undefined, edgeType, { batch: 'unlinkAllFrom' })
  }

  unlinkAllTo(edgeType: string): string {
    return cmd('deleteEdge', undefined, edgeType, { batch: 'unlinkAllTo' })
  }
}

/**
 * Template utilities for in-memory operations.
 */
class InMemoryTemplateUtils implements TemplateUtils {
  buildParams(params: Record<string, unknown>): Record<string, unknown> {
    // Filter out undefined values
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        result[key] = value
      }
    }
    return result
  }

  sanitizeIdentifier(identifier: string): string {
    // For in-memory, we just need to ensure it's a valid string
    return identifier.replace(/[^a-zA-Z0-9_]/g, '_')
  }
}

/**
 * In-memory mutation template provider.
 *
 * Generates JSON command strings instead of Cypher queries.
 * These commands are parsed and executed by InMemoryDriver.
 */
export class InMemoryTemplates implements MutationTemplateProvider {
  readonly name = 'in-memory'
  readonly node = new InMemoryNodeTemplates()
  readonly edge = new InMemoryEdgeTemplates()
  readonly hierarchy = new InMemoryHierarchyTemplates()
  readonly batch = new InMemoryBatchTemplates()
  readonly utils = new InMemoryTemplateUtils()
}

/**
 * Create an in-memory template provider.
 */
export function createInMemoryTemplates(): InMemoryTemplates {
  return new InMemoryTemplates()
}
