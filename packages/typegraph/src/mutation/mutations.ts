/**
 * Graph Mutations Implementation
 *
 * Main implementation of the mutation API.
 * Uses pluggable template providers for query generation.
 */

import type { AnySchema, NodeLabels, NodeProps, EdgeTypes, EdgeProps } from '../schema'
import type {
  GraphMutations,
  MutationTransaction,
  NodeInput,
  EdgeInput,
  NodeResult,
  EdgeResult,
  DeleteResult,
  MoveResult,
  SubtreeResult,
  DeleteSubtreeResult,
  CloneSubtreeResult,
  CreateOptions,
  DeleteOptions,
  HierarchyOptions,
  CloneOptions,
  CloneSubtreeOptions,
  IdGenerator,
  LinkInput,
  BatchDeleteResult,
  UpsertResult,
} from './types'
import { defaultIdGenerator } from './types'
import type { MutationTemplateProvider } from './template-provider'
import { CypherTemplates } from './cypher'
import {
  NodeNotFoundError,
  ParentNotFoundError,
  CycleDetectedError,
  SourceNotFoundError,
  EdgeNotFoundError,
} from './errors'

// =============================================================================
// EXECUTOR INTERFACE (to be implemented by adapter)
// =============================================================================

/**
 * Interface for executing queries.
 * Must be provided by the database adapter.
 */
export interface MutationExecutor {
  run<T>(query: string, params: Record<string, unknown>): Promise<T[]>
  runInTransaction<T>(fn: (tx: TransactionRunner) => Promise<T>): Promise<T>
}

export interface TransactionRunner {
  run<T>(query: string, params: Record<string, unknown>): Promise<T[]>
}

// =============================================================================
// MUTATION CONFIG
// =============================================================================

import type { MutationHooks } from './hooks'
import { HooksRunner } from './hooks'
import type { ValidationOptions } from './validation'
import { MutationValidator, defaultValidationOptions } from './validation'
import type { DryRunOptions } from './dry-run'
import { DryRunBuilder } from './dry-run'

export interface MutationConfig<S extends AnySchema = AnySchema> {
  /** ID generator (defaults to UUID-based) */
  idGenerator?: IdGenerator
  /** Template provider (defaults to Cypher) */
  templates?: MutationTemplateProvider
  /** Lifecycle hooks */
  hooks?: MutationHooks<S>
  /** Validation options */
  validation?: ValidationOptions
  /** Dry-run mode - returns query without executing */
  dryRun?: boolean | DryRunOptions
}

// =============================================================================
// GRAPH MUTATIONS IMPLEMENTATION
// =============================================================================

/**
 * Implementation of GraphMutations interface.
 */
export class GraphMutationsImpl<S extends AnySchema> implements GraphMutations<S> {
  private readonly schema: S
  private readonly executor: MutationExecutor
  private readonly idGenerator: IdGenerator
  private readonly templates: MutationTemplateProvider
  private readonly hooksRunner: HooksRunner<S>
  private readonly validator: MutationValidator<S>
  private readonly validationOptions: Required<ValidationOptions>
  private readonly dryRunMode: boolean
  private readonly dryRunBuilder: DryRunBuilder<S>

  constructor(schema: S, executor: MutationExecutor, config: MutationConfig<S> = {}) {
    this.schema = schema
    this.executor = executor
    this.idGenerator = config.idGenerator ?? defaultIdGenerator
    this.templates = config.templates ?? CypherTemplates
    this.hooksRunner = new HooksRunner(schema, config.hooks)
    this.validator = new MutationValidator(schema)
    this.validationOptions = { ...defaultValidationOptions, ...config.validation }
    this.dryRunMode = typeof config.dryRun === 'boolean' ? config.dryRun : !!config.dryRun
    this.dryRunBuilder = new DryRunBuilder(schema, this.idGenerator)
  }

  // ---------------------------------------------------------------------------
  // NODE CRUD
  // ---------------------------------------------------------------------------

  async create<N extends NodeLabels<S>>(
    label: N,
    data: NodeInput<S, N>,
    options?: CreateOptions,
  ): Promise<NodeResult<S, N>> {
    const safeLabel = this.sanitize(label as string)
    const id = options?.id ?? this.idGenerator.generate(safeLabel)

    // Validate
    if (this.validationOptions.enabled && this.validationOptions.onCreate) {
      this.validator.validateNode(label, data)
    }

    // Run before hooks
    const finalData = await this.hooksRunner.runBeforeCreate(label, data)

    const query = this.templates.node.create(safeLabel)
    const params = this.buildParams({ id, props: finalData })

    // Dry-run mode
    if (this.dryRunMode) {
      return this.dryRunBuilder.createNode(label, finalData, query, options).simulatedResult!
    }

    const results = await this.executor.run<{ n: NodeProps<S, N> }>(query, params)
    const result = results[0]

    if (!result) {
      throw new Error(`Failed to create node: ${label}`)
    }

    const nodeResult: NodeResult<S, N> = { id, data: result.n }

    // Run after hooks
    await this.hooksRunner.runAfterCreate(nodeResult)

    return nodeResult
  }

  async update<N extends NodeLabels<S>>(
    label: N,
    id: string,
    data: Partial<NodeInput<S, N>>,
  ): Promise<NodeResult<S, N>> {
    const safeLabel = this.sanitize(label as string)

    // Validate (partial)
    if (this.validationOptions.enabled && this.validationOptions.onUpdate) {
      this.validator.validateNode(label, data, true)
    }

    // Run before hooks
    const finalData = await this.hooksRunner.runBeforeUpdate(label, id, data)

    const query = this.templates.node.update(safeLabel)
    const params = this.buildParams({ id, props: finalData })

    // Dry-run mode
    if (this.dryRunMode) {
      return this.dryRunBuilder.updateNode(label, id, finalData, query).simulatedResult!
    }

    const results = await this.executor.run<{ n: NodeProps<S, N> }>(query, params)
    const result = results[0]

    if (!result) {
      throw new NodeNotFoundError(label as string, id)
    }

    const nodeResult: NodeResult<S, N> = { id, data: result.n }

    // Run after hooks
    await this.hooksRunner.runAfterUpdate(nodeResult)

    return nodeResult
  }

  async delete<N extends NodeLabels<S>>(
    label: N,
    id: string,
    options?: DeleteOptions,
  ): Promise<DeleteResult> {
    const safeLabel = this.sanitize(label as string)
    const detach = options?.detach ?? true

    // Run before hooks
    await this.hooksRunner.runBeforeDelete(label, id)

    const query = detach
      ? this.templates.node.delete(safeLabel)
      : this.templates.node.deleteKeepEdges(safeLabel)
    const params = this.buildParams({ id })

    // Dry-run mode
    if (this.dryRunMode) {
      return this.dryRunBuilder.deleteNode(safeLabel, id, query).simulatedResult!
    }

    const results = await this.executor.run<{ deleted: boolean }>(query, params)

    const deleteResult: DeleteResult = {
      deleted: results[0]?.deleted ?? false,
      id,
    }

    // Run after hooks
    await this.hooksRunner.runAfterDelete(deleteResult)

    return deleteResult
  }

  async upsert<N extends NodeLabels<S>>(
    label: N,
    id: string,
    data: NodeInput<S, N>,
  ): Promise<UpsertResult<S, N>> {
    const safeLabel = this.sanitize(label as string)

    // Validate
    if (this.validationOptions.enabled && this.validationOptions.onCreate) {
      this.validator.validateNode(label, data)
    }

    const query = this.templates.node.upsert(safeLabel)
    const params = this.buildParams({
      id,
      createProps: data,
      updateProps: data,
    })

    const results = await this.executor.run<{ n: NodeProps<S, N>; created: boolean }>(query, params)
    const result = results[0]

    if (!result) {
      throw new Error(`Failed to upsert node: ${label}`)
    }

    return {
      id,
      data: result.n,
      created: result.created,
    }
  }

  // ---------------------------------------------------------------------------
  // EDGE CRUD
  // ---------------------------------------------------------------------------

  async link<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
    data?: EdgeInput<S, E>,
  ): Promise<EdgeResult<S, E>> {
    const safeEdge = this.sanitize(edge as string)
    const edgeId = this.idGenerator.generate(safeEdge)

    // Validate edge data
    if (this.validationOptions.enabled && this.validationOptions.onCreate && data) {
      this.validator.validateEdge(edge, data)
    }

    // Run before hooks
    const finalData = await this.hooksRunner.runBeforeLink(edge, from, to, data)

    const query = finalData
      ? this.templates.edge.create(safeEdge)
      : this.templates.edge.createNoProps(safeEdge)
    const params = this.buildParams({
      fromId: from,
      toId: to,
      edgeId,
      props: finalData ?? {},
    })

    // Dry-run mode
    if (this.dryRunMode) {
      return this.dryRunBuilder.createEdge(edge, from, to, finalData, query).simulatedResult!
    }

    const results = await this.executor.run<{ r: EdgeProps<S, E>; fromId: string; toId: string }>(
      query,
      params,
    )
    const result = results[0]

    if (!result) {
      throw new Error(`Failed to create edge: ${edge} from ${from} to ${to}`)
    }

    const edgeResult: EdgeResult<S, E> = {
      id: edgeId,
      from: result.fromId,
      to: result.toId,
      data: result.r,
    }

    // Run after hooks
    await this.hooksRunner.runAfterLink(edgeResult)

    return edgeResult
  }

  async patchLink<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
    data: Partial<EdgeInput<S, E>>,
  ): Promise<EdgeResult<S, E>> {
    const safeEdge = this.sanitize(edge as string)

    const query = this.templates.edge.update(safeEdge)
    const params = this.buildParams({
      fromId: from,
      toId: to,
      props: data,
    })

    const results = await this.executor.run<{ r: EdgeProps<S, E>; fromId: string; toId: string }>(
      query,
      params,
    )
    const result = results[0]

    if (!result) {
      throw new EdgeNotFoundError(edge as string, from, to)
    }

    return {
      id: result.r.id,
      from: result.fromId,
      to: result.toId,
      data: result.r,
    }
  }

  async unlink<E extends EdgeTypes<S>>(edge: E, from: string, to: string): Promise<DeleteResult> {
    const safeEdge = this.sanitize(edge as string)

    // Run before hooks
    await this.hooksRunner.runBeforeUnlink(edge, from, to)

    const query = this.templates.edge.deleteByEndpoints(safeEdge)
    const params = this.buildParams({ fromId: from, toId: to })

    // Dry-run mode
    if (this.dryRunMode) {
      return this.dryRunBuilder.deleteEdge(safeEdge, from, to, query).simulatedResult!
    }

    const results = await this.executor.run<{ deleted: boolean }>(query, params)

    const deleteResult: DeleteResult = {
      deleted: results[0]?.deleted ?? false,
      id: `${from}->${to}`,
    }

    // Run after hooks
    await this.hooksRunner.runAfterUnlink(deleteResult)

    return deleteResult
  }

  async unlinkById<E extends EdgeTypes<S>>(edge: E, edgeId: string): Promise<DeleteResult> {
    const safeEdge = this.sanitize(edge as string)

    const query = this.templates.edge.deleteById(safeEdge)
    const params = this.buildParams({ edgeId })

    const results = await this.executor.run<{ deleted: boolean }>(query, params)

    return {
      deleted: results[0]?.deleted ?? false,
      id: edgeId,
    }
  }

  // ---------------------------------------------------------------------------
  // HIERARCHY OPERATIONS
  // ---------------------------------------------------------------------------

  async createChild<N extends NodeLabels<S>>(
    label: N,
    parentId: string,
    data: NodeInput<S, N>,
    options?: HierarchyOptions<S>,
  ): Promise<NodeResult<S, N>> {
    const safeLabel = this.sanitize(label as string)
    const edgeType = this.resolveHierarchyEdge(options?.edge)
    const id = this.idGenerator.generate(safeLabel)

    const query = this.templates.hierarchy.createChild(safeLabel, edgeType)
    const params = this.buildParams({ id, parentId, props: data })

    const results = await this.executor.run<{ child: NodeProps<S, N> }>(query, params)
    const result = results[0]

    if (!result) {
      throw new ParentNotFoundError(parentId)
    }

    return { id, data: result.child }
  }

  async move(
    nodeId: string,
    newParentId: string,
    options?: HierarchyOptions<S>,
  ): Promise<MoveResult> {
    const edgeType = this.resolveHierarchyEdge(options?.edge)

    // Check for cycle
    const cycleCheck = this.templates.hierarchy.wouldCreateCycle(edgeType)
    const cycleResults = await this.executor.run<{ wouldCycle: boolean }>(cycleCheck, {
      nodeId,
      newParentId,
    })

    if (cycleResults[0]?.wouldCycle) {
      throw new CycleDetectedError(nodeId, newParentId)
    }

    // Try to move (handles case where node has existing parent)
    const moveQuery = this.templates.hierarchy.move(edgeType)
    let results = await this.executor.run<{
      nodeId: string
      previousParentId: string | null
      newParentId: string
    }>(moveQuery, { nodeId, newParentId })

    // If no results, node might be an orphan - try orphan move
    if (results.length === 0) {
      const orphanQuery = this.templates.hierarchy.moveOrphan(edgeType)
      results = await this.executor.run<{
        nodeId: string
        previousParentId: string | null
        newParentId: string
      }>(orphanQuery, { nodeId, newParentId })
    }

    const result = results[0]
    if (!result) {
      throw new NodeNotFoundError('node', nodeId)
    }

    return {
      moved: true,
      nodeId: result.nodeId,
      previousParentId: result.previousParentId,
      newParentId: result.newParentId,
    }
  }

  async moveSubtree(
    rootId: string,
    newParentId: string,
    options?: HierarchyOptions<S>,
  ): Promise<SubtreeResult> {
    // For moveSubtree, we only need to move the root - descendants follow automatically
    await this.move(rootId, newParentId, options)

    // Count affected nodes (root + descendants)
    const edgeType = this.resolveHierarchyEdge(options?.edge)
    const countQuery = this.templates.hierarchy.getSubtree(edgeType)
    const countResults = await this.executor.run<{ node: unknown; depth: number }>(countQuery, {
      rootId,
    })

    return {
      rootId,
      affectedNodes: countResults.length,
    }
  }

  async clone<N extends NodeLabels<S>>(
    label: N,
    sourceId: string,
    overrides?: Partial<NodeInput<S, N>>,
    options?: CloneOptions<S>,
  ): Promise<NodeResult<S, N>> {
    const safeLabel = this.sanitize(label as string)
    const newId = this.idGenerator.generate(safeLabel)

    let query: string
    let params: Record<string, unknown>

    if (options?.parentId) {
      const edgeType = this.resolveHierarchyEdge(options.edge)
      query = this.templates.hierarchy.cloneWithParent(safeLabel, edgeType)
      params = this.buildParams({
        sourceId,
        newId,
        parentId: options.parentId,
        overrides: overrides ?? {},
      })
    } else if (options?.preserveParent) {
      const edgeType = this.resolveHierarchyEdge(options.edge)
      query = this.templates.hierarchy.clonePreserveParent(safeLabel, edgeType)
      params = this.buildParams({
        sourceId,
        newId,
        overrides: overrides ?? {},
      })
    } else {
      query = this.templates.node.clone(safeLabel)
      params = this.buildParams({
        sourceId,
        newId,
        overrides: overrides ?? {},
      })
    }

    const results = await this.executor.run<{ clone: NodeProps<S, N> }>(query, params)
    const result = results[0]

    if (!result) {
      throw new SourceNotFoundError(label as string, sourceId)
    }

    return { id: newId, data: result.clone }
  }

  /**
   * Clone a subtree preserving original node labels.
   * Queries each node's actual label from the database and creates clones with the correct labels.
   * Supports heterogeneous subtrees (e.g., a tree containing both "module" and "group" nodes).
   */
  async cloneSubtree(
    sourceRootId: string,
    options?: CloneSubtreeOptions<S>,
  ): Promise<CloneSubtreeResult<S, NodeLabels<S>>> {
    const edgeType = this.resolveHierarchyEdge(options?.edge)

    // Get all nodes in subtree with depth and their labels
    const getSubtreeQuery = this.templates.hierarchy.getSubtree(edgeType)
    const subtreeNodes = await this.executor.run<{
      node: NodeProps<S, NodeLabels<S>>
      depth: number
      nodeLabels: string[]
    }>(getSubtreeQuery, { rootId: sourceRootId })

    if (subtreeNodes.length === 0) {
      throw new SourceNotFoundError('node', sourceRootId)
    }

    // Filter by maxDepth if specified
    const nodesToClone =
      options?.maxDepth !== undefined
        ? subtreeNodes.filter((n) => n.depth <= options.maxDepth!)
        : subtreeNodes

    // Create ID mapping - use each node's actual label for ID generation
    const idMapping: Record<string, string> = {}
    const labelMapping: Record<string, string> = {}
    for (const { node, nodeLabels } of nodesToClone) {
      const safeLabel = this.sanitize(nodeLabels[0]!)
      idMapping[node.id] = this.idGenerator.generate(safeLabel)
      labelMapping[node.id] = safeLabel
    }

    // Clone in transaction
    const rootResult = await this.executor.runInTransaction(async (tx) => {
      let clonedRoot: NodeResult<S, NodeLabels<S>> | null = null

      // Clone nodes in order (root first, then by depth)
      for (const { node, depth } of nodesToClone) {
        const newId = idMapping[node.id]
        const nodeLabel = labelMapping[node.id]
        if (!newId || !nodeLabel) continue

        const { id: _id, ...nodeData } = node

        // Apply transform if provided
        let finalData = nodeData as NodeInput<S, NodeLabels<S>>
        if (options?.transform) {
          const transformed = options.transform(node, depth)
          finalData = { ...finalData, ...transformed }
        }

        // Create node with its original label
        const createQuery = this.templates.node.create(nodeLabel)
        const createResults = await tx.run<{ n: NodeProps<S, NodeLabels<S>> }>(createQuery, {
          id: newId,
          props: finalData,
        })

        const createResult = createResults[0]
        if (depth === 0 && createResult) {
          clonedRoot = { id: newId, data: createResult.n }
        }
      }

      // Recreate internal edges (parent relationships within subtree)
      for (const { node } of nodesToClone) {
        const clonedId = idMapping[node.id]
        if (!clonedId) continue

        // Get original parent
        const getParentQuery = this.templates.hierarchy.getParent(edgeType)
        const parentResults = await tx.run<{ parentId: string }>(getParentQuery, {
          nodeId: node.id,
        })

        const parentResult = parentResults[0]
        if (parentResult) {
          const originalParentId = parentResult.parentId
          const clonedParentId = idMapping[originalParentId]
          // Only create edge if parent is also in the subtree
          if (clonedParentId) {
            const createEdgeQuery = this.templates.edge.createNoProps(edgeType)
            await tx.run(createEdgeQuery, {
              fromId: clonedId,
              toId: clonedParentId,
              edgeId: this.idGenerator.generate(edgeType),
            })
          }
        }
      }

      // Link root to new parent if specified
      if (options?.parentId && clonedRoot) {
        const createEdgeQuery = this.templates.edge.createNoProps(edgeType)
        await tx.run(createEdgeQuery, {
          fromId: clonedRoot.id,
          toId: options.parentId,
          edgeId: this.idGenerator.generate(edgeType),
        })
      }

      return clonedRoot
    })

    if (!rootResult) {
      throw new Error('Failed to clone subtree: no root created')
    }

    return {
      root: rootResult,
      clonedNodes: nodesToClone.length,
      idMapping,
    }
  }

  async deleteSubtree<N extends NodeLabels<S>>(
    _label: N,
    rootId: string,
    options?: HierarchyOptions<S>,
  ): Promise<DeleteSubtreeResult> {
    const edgeType = this.resolveHierarchyEdge(options?.edge)

    const query = this.templates.hierarchy.deleteSubtree(edgeType)
    const results = await this.executor.run<{ deletedNodes: number }>(query, { rootId })

    return {
      rootId,
      deletedNodes: results[0]?.deletedNodes ?? 0,
      deletedEdges: 0, // DETACH DELETE handles edges
    }
  }

  // ---------------------------------------------------------------------------
  // BATCH OPERATIONS
  // ---------------------------------------------------------------------------

  async createMany<N extends NodeLabels<S>>(
    label: N,
    items: NodeInput<S, N>[],
    options?: CreateOptions,
  ): Promise<NodeResult<S, N>[]> {
    const safeLabel = this.sanitize(label as string)

    const itemsWithIds = items.map((props) => ({
      id: options?.id ?? this.idGenerator.generate(safeLabel),
      props,
    }))

    const query = this.templates.batch.createMany(safeLabel)
    const results = await this.executor.run<{ n: NodeProps<S, N> }>(query, { items: itemsWithIds })

    return results.map((r, i) => ({
      id: itemsWithIds[i]?.id ?? '',
      data: r.n,
    }))
  }

  async updateMany<N extends NodeLabels<S>>(
    label: N,
    updates: Array<{ id: string; data: Partial<NodeInput<S, N>> }>,
  ): Promise<NodeResult<S, N>[]> {
    const safeLabel = this.sanitize(label as string)

    const updateItems = updates.map((u) => ({
      id: u.id,
      props: u.data,
    }))

    const query = this.templates.batch.updateMany(safeLabel)
    const results = await this.executor.run<{ n: NodeProps<S, N> }>(query, { updates: updateItems })

    return results.map((r) => ({
      id: r.n.id,
      data: r.n,
    }))
  }

  async deleteMany<N extends NodeLabels<S>>(
    label: N,
    ids: string[],
    _options?: DeleteOptions,
  ): Promise<DeleteResult> {
    const safeLabel = this.sanitize(label as string)

    const query = this.templates.batch.deleteMany(safeLabel)
    const results = await this.executor.run<{ deletedCount: number }>(query, { ids })

    return {
      deleted: (results[0]?.deletedCount ?? 0) > 0,
      id: ids.join(','),
    }
  }

  async linkMany<E extends EdgeTypes<S>>(
    edge: E,
    links: LinkInput<S, E>[],
  ): Promise<EdgeResult<S, E>[]> {
    if (links.length === 0) return []

    const safeEdge = this.sanitize(edge as string)

    const linksWithIds = links.map((link) => ({
      from: link.from,
      to: link.to,
      data: link.data ?? {},
      id: this.idGenerator.generate(safeEdge),
    }))

    const query = this.templates.batch.linkMany(safeEdge)
    const results = await this.executor.run<{ r: EdgeProps<S, E>; fromId: string; toId: string }>(
      query,
      { links: linksWithIds },
    )

    return results.map((r, i) => ({
      id: linksWithIds[i]?.id ?? '',
      from: r.fromId,
      to: r.toId,
      data: r.r,
    }))
  }

  async unlinkMany<E extends EdgeTypes<S>>(
    edge: E,
    links: Array<{ from: string; to: string }>,
  ): Promise<BatchDeleteResult> {
    if (links.length === 0) return { deleted: 0 }

    const safeEdge = this.sanitize(edge as string)

    const query = this.templates.batch.unlinkMany(safeEdge)
    const results = await this.executor.run<{ deleted: number }>(query, { links })

    return { deleted: results[0]?.deleted ?? 0 }
  }

  async unlinkAllFrom<E extends EdgeTypes<S>>(edge: E, from: string): Promise<BatchDeleteResult> {
    const safeEdge = this.sanitize(edge as string)

    const query = this.templates.batch.unlinkAllFrom(safeEdge)
    const results = await this.executor.run<{ deleted: number }>(query, { from })

    return { deleted: results[0]?.deleted ?? 0 }
  }

  async unlinkAllTo<E extends EdgeTypes<S>>(edge: E, to: string): Promise<BatchDeleteResult> {
    const safeEdge = this.sanitize(edge as string)

    const query = this.templates.batch.unlinkAllTo(safeEdge)
    const results = await this.executor.run<{ deleted: number }>(query, { to })

    return { deleted: results[0]?.deleted ?? 0 }
  }

  // ---------------------------------------------------------------------------
  // TRANSACTIONS
  // ---------------------------------------------------------------------------

  async transaction<T>(fn: (tx: MutationTransaction<S>) => Promise<T>): Promise<T> {
    return this.executor.runInTransaction(async (runner) => {
      const txContext = new MutationTransactionImpl<S>(
        this.schema,
        runner,
        this.idGenerator,
        this.templates,
      )
      return fn(txContext)
    })
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  private sanitize(identifier: string): string {
    return this.templates.utils.sanitizeIdentifier(identifier)
  }

  private buildParams(params: Record<string, unknown>): Record<string, unknown> {
    return this.templates.utils.buildParams(params)
  }

  private resolveHierarchyEdge(edge?: EdgeTypes<S>): string {
    if (edge) return this.sanitize(edge as string)

    const hierarchy = this.schema.hierarchy
    if (!hierarchy?.defaultEdge) {
      throw new Error(
        'No hierarchy edge specified and schema has no default hierarchy configuration',
      )
    }
    return this.sanitize(hierarchy.defaultEdge)
  }
}

// =============================================================================
// MUTATION TRANSACTION IMPLEMENTATION
// =============================================================================

class MutationTransactionImpl<S extends AnySchema> implements MutationTransaction<S> {
  private readonly schema: S
  private readonly runner: TransactionRunner
  private readonly idGenerator: IdGenerator
  private readonly templates: MutationTemplateProvider

  constructor(
    schema: S,
    runner: TransactionRunner,
    idGenerator: IdGenerator,
    templates: MutationTemplateProvider,
  ) {
    this.schema = schema
    this.runner = runner
    this.idGenerator = idGenerator
    this.templates = templates
  }

  async create<N extends NodeLabels<S>>(
    label: N,
    data: NodeInput<S, N>,
    options?: CreateOptions,
  ): Promise<NodeResult<S, N>> {
    const safeLabel = this.sanitize(label as string)
    const id = options?.id ?? this.idGenerator.generate(safeLabel)

    const query = this.templates.node.create(safeLabel)
    const results = await this.runner.run<{ n: NodeProps<S, N> }>(query, { id, props: data })
    const result = results[0]

    if (!result) {
      throw new Error(`Failed to create node: ${label}`)
    }

    return { id, data: result.n }
  }

  async update<N extends NodeLabels<S>>(
    label: N,
    id: string,
    data: Partial<NodeInput<S, N>>,
  ): Promise<NodeResult<S, N>> {
    const safeLabel = this.sanitize(label as string)

    const query = this.templates.node.update(safeLabel)
    const results = await this.runner.run<{ n: NodeProps<S, N> }>(query, { id, props: data })
    const result = results[0]

    if (!result) {
      throw new NodeNotFoundError(label as string, id)
    }

    return { id, data: result.n }
  }

  async delete<N extends NodeLabels<S>>(
    label: N,
    id: string,
    options?: DeleteOptions,
  ): Promise<DeleteResult> {
    const safeLabel = this.sanitize(label as string)
    const detach = options?.detach ?? true

    const query = detach
      ? this.templates.node.delete(safeLabel)
      : this.templates.node.deleteKeepEdges(safeLabel)
    const results = await this.runner.run<{ deleted: boolean }>(query, { id })

    return { deleted: results[0]?.deleted ?? false, id }
  }

  async upsert<N extends NodeLabels<S>>(
    label: N,
    id: string,
    data: NodeInput<S, N>,
  ): Promise<UpsertResult<S, N>> {
    const safeLabel = this.sanitize(label as string)

    const query = this.templates.node.upsert(safeLabel)
    const results = await this.runner.run<{ n: NodeProps<S, N>; created: boolean }>(query, {
      id,
      createProps: data,
      updateProps: data,
    })

    const result = results[0]
    if (!result) {
      throw new Error(`Failed to upsert node: ${label}`)
    }

    return {
      id,
      data: result.n,
      created: result.created,
    }
  }

  async link<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
    data?: EdgeInput<S, E>,
  ): Promise<EdgeResult<S, E>> {
    const safeEdge = this.sanitize(edge as string)
    const edgeId = this.idGenerator.generate(safeEdge)

    const query = data
      ? this.templates.edge.create(safeEdge)
      : this.templates.edge.createNoProps(safeEdge)
    const results = await this.runner.run<{ r: EdgeProps<S, E>; fromId: string; toId: string }>(
      query,
      {
        fromId: from,
        toId: to,
        edgeId,
        props: data ?? {},
      },
    )

    const result = results[0]
    if (!result) {
      throw new Error(`Failed to create edge: ${edge} from ${from} to ${to}`)
    }

    return {
      id: edgeId,
      from: result.fromId,
      to: result.toId,
      data: result.r,
    }
  }

  async patchLink<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
    data: Partial<EdgeInput<S, E>>,
  ): Promise<EdgeResult<S, E>> {
    const safeEdge = this.sanitize(edge as string)

    const query = this.templates.edge.update(safeEdge)
    const results = await this.runner.run<{ r: EdgeProps<S, E>; fromId: string; toId: string }>(
      query,
      {
        fromId: from,
        toId: to,
        props: data,
      },
    )

    const result = results[0]
    if (!result) {
      throw new EdgeNotFoundError(edge as string, from, to)
    }

    return {
      id: result.r.id,
      from: result.fromId,
      to: result.toId,
      data: result.r,
    }
  }

  async unlink<E extends EdgeTypes<S>>(edge: E, from: string, to: string): Promise<DeleteResult> {
    const safeEdge = this.sanitize(edge as string)

    const query = this.templates.edge.deleteByEndpoints(safeEdge)
    const results = await this.runner.run<{ deleted: boolean }>(query, { fromId: from, toId: to })

    return { deleted: results[0]?.deleted ?? false, id: `${from}->${to}` }
  }

  async linkMany<E extends EdgeTypes<S>>(
    edge: E,
    links: LinkInput<S, E>[],
  ): Promise<EdgeResult<S, E>[]> {
    if (links.length === 0) return []

    const safeEdge = this.sanitize(edge as string)

    const linksWithIds = links.map((link) => ({
      from: link.from,
      to: link.to,
      data: link.data ?? {},
      id: this.idGenerator.generate(safeEdge),
    }))

    const query = this.templates.batch.linkMany(safeEdge)
    const results = await this.runner.run<{ r: EdgeProps<S, E>; fromId: string; toId: string }>(
      query,
      { links: linksWithIds },
    )

    return results.map((r, i) => ({
      id: linksWithIds[i]?.id ?? '',
      from: r.fromId,
      to: r.toId,
      data: r.r,
    }))
  }

  async unlinkMany<E extends EdgeTypes<S>>(
    edge: E,
    links: Array<{ from: string; to: string }>,
  ): Promise<BatchDeleteResult> {
    if (links.length === 0) return { deleted: 0 }

    const safeEdge = this.sanitize(edge as string)

    const query = this.templates.batch.unlinkMany(safeEdge)
    const results = await this.runner.run<{ deleted: number }>(query, { links })

    return { deleted: results[0]?.deleted ?? 0 }
  }

  async createChild<N extends NodeLabels<S>>(
    label: N,
    parentId: string,
    data: NodeInput<S, N>,
    options?: HierarchyOptions<S>,
  ): Promise<NodeResult<S, N>> {
    const safeLabel = this.sanitize(label as string)
    const edgeType = this.resolveHierarchyEdge(options?.edge)
    const id = this.idGenerator.generate(safeLabel)

    const query = this.templates.hierarchy.createChild(safeLabel, edgeType)
    const results = await this.runner.run<{ child: NodeProps<S, N> }>(query, {
      id,
      parentId,
      props: data,
    })
    const result = results[0]

    if (!result) {
      throw new ParentNotFoundError(parentId)
    }

    return { id, data: result.child }
  }

  async move(
    nodeId: string,
    newParentId: string,
    options?: HierarchyOptions<S>,
  ): Promise<MoveResult> {
    const edgeType = this.resolveHierarchyEdge(options?.edge)

    const moveQuery = this.templates.hierarchy.move(edgeType)
    let results = await this.runner.run<{
      nodeId: string
      previousParentId: string | null
      newParentId: string
    }>(moveQuery, { nodeId, newParentId })

    if (results.length === 0) {
      const orphanQuery = this.templates.hierarchy.moveOrphan(edgeType)
      results = await this.runner.run<{
        nodeId: string
        previousParentId: string | null
        newParentId: string
      }>(orphanQuery, { nodeId, newParentId })
    }

    const result = results[0]
    if (!result) {
      throw new NodeNotFoundError('node', nodeId)
    }

    return {
      moved: true,
      nodeId: result.nodeId,
      previousParentId: result.previousParentId,
      newParentId: result.newParentId,
    }
  }

  private sanitize(identifier: string): string {
    return this.templates.utils.sanitizeIdentifier(identifier)
  }

  private resolveHierarchyEdge(edge?: EdgeTypes<S>): string {
    if (edge) return this.sanitize(edge as string)

    const hierarchy = (this.schema as { hierarchy?: { defaultEdge?: string } }).hierarchy
    if (!hierarchy?.defaultEdge) {
      throw new Error(
        'No hierarchy edge specified and schema has no default hierarchy configuration',
      )
    }
    return this.sanitize(hierarchy.defaultEdge)
  }
}
