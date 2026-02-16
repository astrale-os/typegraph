/**
 * Graph Mutations Implementation
 *
 * Each method follows: validate → hooks(before) → build op → pipeline → compile → execute → hooks(after)
 * The mutation AST enables compilation passes (InstanceModelPass, ReifyEdgesPass) to transform mutations.
 */

import type { SchemaShape, TypeMap, UntypedMap } from '../schema'
import type { NodeLabels, NodeProps, EdgeTypes, EdgeProps } from '../inference'
import { resolveNodeLabels, edgeFrom, edgeTo } from '../helpers'
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
import {
  NodeNotFoundError,
  ParentNotFoundError,
  CycleDetectedError,
  SourceNotFoundError,
  EdgeNotFoundError,
  HasRelationshipsError,
} from './errors'
import { deserializeDateFields } from '../utils/dates'
import * as ops from './ast/builder'
import type { MutationOp } from './ast/types'
import { MutationCompilationPipeline } from './ast/pipeline'
import type { MutationCompilationPass } from './ast/pipeline'
import { MutationCypherCompiler } from './cypher/compiler'
import type { CompiledMutation } from './cypher/compiler'

// =============================================================================
// SHARED UTILITIES
// =============================================================================

function resolveEdgeEndpointLabels<S extends SchemaShape>(
  schema: S,
  edge: EdgeTypes<S>,
): { fromLabels: string[]; toLabels: string[] } {
  const fromTypes = edgeFrom(schema, edge as string)
  const toTypes = edgeTo(schema, edge as string)
  const fromLabels = fromTypes[0] ? resolveNodeLabels(schema, fromTypes[0]) : []
  const toLabels = toTypes[0] ? resolveNodeLabels(schema, toTypes[0]) : []
  return { fromLabels, toLabels }
}

// =============================================================================
// EXECUTOR INTERFACE
// =============================================================================

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
import {
  MutationValidator,
  defaultValidationOptions,
  stripUndefined,
  serializeDates,
} from './validation'
import { ValidationError } from './errors'
import type { DryRunOptions } from './dry-run'
import { DryRunBuilder } from './dry-run'

export interface MutationConfig<S extends SchemaShape = SchemaShape> {
  idGenerator?: IdGenerator
  mutationPasses?: MutationCompilationPass[]
  hooks?: MutationHooks<S>
  validation?: ValidationOptions
  dryRun?: boolean | DryRunOptions
}

// =============================================================================
// GRAPH MUTATIONS IMPLEMENTATION
// =============================================================================

export class GraphMutationsImpl<S extends SchemaShape, T extends TypeMap = UntypedMap> implements GraphMutations<S, T> {
  private readonly schema: S
  private readonly executor: MutationExecutor
  private readonly idGenerator: IdGenerator
  private readonly pipeline: MutationCompilationPipeline
  private readonly compiler: MutationCypherCompiler
  private readonly hooksRunner: HooksRunner<S>
  private readonly validator: MutationValidator<S>
  private readonly validationOptions: Required<Omit<ValidationOptions, 'validators'>>
  private readonly dryRunMode: boolean
  private readonly dryRunBuilder: DryRunBuilder<S, T>

  constructor(schema: S, executor: MutationExecutor, config: MutationConfig<S> = {}) {
    this.schema = schema
    this.executor = executor
    this.idGenerator = config.idGenerator ?? defaultIdGenerator
    this.pipeline = new MutationCompilationPipeline(config.mutationPasses)
    this.compiler = new MutationCypherCompiler()
    this.hooksRunner = new HooksRunner(schema, config.hooks)
    this.validator = new MutationValidator(schema, config.validation?.validators)
    this.validationOptions = { ...defaultValidationOptions, ...config.validation }
    this.dryRunMode = typeof config.dryRun === 'boolean' ? config.dryRun : !!config.dryRun
    this.dryRunBuilder = new DryRunBuilder<S, T>(schema, this.idGenerator)
  }

  // ---------------------------------------------------------------------------
  // NODE CRUD
  // ---------------------------------------------------------------------------

  async create<N extends NodeLabels<S>>(
    label: N,
    data: NodeInput<S, N, T>,
    options?: CreateOptions,
  ): Promise<NodeResult<S, N, T>> {
    const id = (options?.id ?? this.idGenerator.generate(label as string)) as string

    // Validate
    let validatedData: Record<string, unknown>
    if (this.validationOptions.enabled && this.validationOptions.onCreate) {
      validatedData = this.validator.parseAndPrepareNode(label, data)
    } else {
      validatedData = stripUndefined(data as Record<string, unknown>)
    }

    // Hooks (before)
    const hookData = await this.hooksRunner.runBeforeCreate(label, validatedData as NodeInput<S, N>)
    const dbReadyData = serializeDates(stripUndefined(hookData as Record<string, unknown>))

    // Build op
    const links = options?.link
      ? Object.entries(options.link).map(([edgeType, targetId]) => {
          if (targetId == null || targetId === '') {
            throw new Error(
              `Invalid link target for edge type '${edgeType}': expected a node ID or 'self', got ${JSON.stringify(targetId)}`,
            )
          }
          return { edgeType, targetId: targetId === 'self' ? id : targetId }
        })
      : undefined

    const op = ops.createNode(label as string, id, dbReadyData, {
      additionalLabels: options?.additionalLabels,
      links,
    })

    // Pipeline → compile → execute
    const compiled = this.runPipeline(op)

    if (this.dryRunMode) {
      return this.dryRunBuilder.createNode(label, dbReadyData as NodeInput<S, N>, compiled.query, options)
        .simulatedResult! as unknown as NodeResult<S, N, T>
    }

    const results = await this.executor.run<{ n: NodeProps<S, N> }>(compiled.query, compiled.params)
    const result = results[0]

    if (!result) {
      if (options?.link && Object.keys(options.link).length > 0) {
        throw new Error(
          `Failed to create node '${String(label)}': one or more link targets not found. Links: ${JSON.stringify(options.link)}`,
        )
      }
      throw new Error(`Failed to create node: ${label}`)
    }

    const nodeResult: NodeResult<S, N, T> = {
      id,
      data: this.deserializeDates(label, result.n) as any,
    }

    await this.hooksRunner.runAfterCreate(nodeResult as any)
    return nodeResult
  }

  async update<N extends NodeLabels<S>>(
    label: N,
    id: string,
    data: Partial<NodeInput<S, N, T>>,
  ): Promise<NodeResult<S, N, T>> {
    let validatedData: Record<string, unknown>
    if (this.validationOptions.enabled && this.validationOptions.onUpdate) {
      validatedData = this.validator.parseAndPrepareNode(label, data, true)
    } else {
      validatedData = stripUndefined(data as Record<string, unknown>)
    }

    const hookData = await this.hooksRunner.runBeforeUpdate(
      label, id, validatedData as Partial<NodeInput<S, N>>,
    )
    const dbReadyData = serializeDates(stripUndefined(hookData as Record<string, unknown>))

    const op = ops.updateNode(label as string, id, dbReadyData)
    const compiled = this.runPipeline(op)

    if (this.dryRunMode) {
      return this.dryRunBuilder.updateNode(label, id, dbReadyData as Partial<NodeInput<S, N>>, compiled.query)
        .simulatedResult! as unknown as NodeResult<S, N, T>
    }

    const results = await this.executor.run<{ n: NodeProps<S, N> }>(compiled.query, compiled.params)
    const result = results[0]

    if (!result) {
      throw new NodeNotFoundError(label as string, id)
    }

    const nodeResult: NodeResult<S, N, T> = {
      id,
      data: this.deserializeDates(label, result.n) as any,
    }

    await this.hooksRunner.runAfterUpdate(nodeResult as any)
    return nodeResult
  }

  async delete<N extends NodeLabels<S>>(
    label: N,
    id: string,
    options?: DeleteOptions,
  ): Promise<DeleteResult> {
    const detach = options?.detach ?? true

    await this.hooksRunner.runBeforeDelete(label, id)

    const op = ops.deleteNode(label as string, id, detach)
    const compiled = this.runPipeline(op)

    if (this.dryRunMode) {
      return this.dryRunBuilder.deleteNode(label as string, id, compiled.query).simulatedResult!
    }

    const results = await this.executor.run<{ deleted: boolean; relCount?: number }>(
      compiled.query, compiled.params,
    )

    if (!detach && results.length === 0) {
      const safeLabels = resolveNodeLabels(this.schema, label as string)
      const labelStr = safeLabels.map((l) => `:${l}`).join('')
      const checkQuery = `
        OPTIONAL MATCH (n${labelStr} {id: $id})
        OPTIONAL MATCH (n)-[r]-()
        RETURN n IS NOT NULL as exists, count(r) as relCount
      `
      const checkResult = await this.executor.run<{ exists: boolean; relCount: number }>(
        checkQuery, { id },
      )
      const { exists, relCount } = checkResult[0] ?? { exists: false, relCount: 0 }
      if (exists && relCount > 0) {
        throw new HasRelationshipsError(label as string, id, relCount)
      }
    }

    const deleteResult: DeleteResult = { deleted: results[0]?.deleted ?? false, id }

    await this.hooksRunner.runAfterDelete(deleteResult)
    return deleteResult
  }

  async upsert<N extends NodeLabels<S>>(
    label: N,
    id: string,
    data: NodeInput<S, N, T>,
  ): Promise<UpsertResult<S, N, T>> {
    let validatedData: Record<string, unknown>
    if (this.validationOptions.enabled && this.validationOptions.onCreate) {
      validatedData = this.validator.parseAndPrepareNode(label, data)
    } else {
      validatedData = stripUndefined(data as Record<string, unknown>)
    }

    const dbReadyData = serializeDates(validatedData)

    const op = ops.upsertNode(label as string, id, dbReadyData)
    const compiled = this.runPipeline(op)

    const results = await this.executor.run<{ n: NodeProps<S, N>; created: boolean }>(
      compiled.query, compiled.params,
    )
    const result = results[0]

    if (!result) {
      throw new Error(`Failed to upsert node: ${label}`)
    }

    return {
      id,
      data: this.deserializeDates(label, result.n) as any,
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
    data?: EdgeInput<S, E, T>,
  ): Promise<EdgeResult<S, E, T>> {
    const edgeId = this.idGenerator.generate(edge as string)

    let validatedEdgeData: Record<string, unknown> | undefined
    if (this.validationOptions.enabled && this.validationOptions.onCreate && data) {
      validatedEdgeData = this.validator.parseAndPrepareEdge(edge, data)
    } else if (data) {
      validatedEdgeData = stripUndefined(data as Record<string, unknown>)
    }

    const hookData = await this.hooksRunner.runBeforeLink(
      edge, from, to, validatedEdgeData as EdgeInput<S, E> | undefined,
    )
    const dbReadyEdgeData = hookData
      ? serializeDates(stripUndefined(hookData as Record<string, unknown>))
      : undefined

    const op = ops.createEdge(edge as string, from, to, edgeId, dbReadyEdgeData)
    const compiled = this.runPipeline(op)

    if (this.dryRunMode) {
      return this.dryRunBuilder.createEdge(
        edge, from, to, dbReadyEdgeData as EdgeInput<S, E> | undefined, compiled.query,
      ).simulatedResult!
    }

    const results = await this.executor.run<{ r: EdgeProps<S, E>; fromId: string; toId: string }>(
      compiled.query, compiled.params,
    )
    const result = results[0]

    if (!result) {
      throw new Error(`Failed to create edge: ${edge} from ${from} to ${to}`)
    }

    const edgeResult: EdgeResult<S, E, T> = {
      id: edgeId,
      from: result.fromId,
      to: result.toId,
      data: result.r as any,
    }

    await this.hooksRunner.runAfterLink(edgeResult as any)
    return edgeResult
  }

  async patchLink<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
    data: Partial<EdgeInput<S, E, T>>,
  ): Promise<EdgeResult<S, E, T>> {
    let validatedData: Record<string, unknown>
    if (this.validationOptions.enabled && this.validationOptions.onUpdate) {
      validatedData = this.validator.parseAndPrepareEdge(edge, data, true) ?? {}
    } else {
      validatedData = stripUndefined(data as Record<string, unknown>)
    }

    const dbReadyData = serializeDates(validatedData)
    const op = ops.updateEdge(edge as string, from, to, dbReadyData)
    const compiled = this.runPipeline(op)

    const results = await this.executor.run<{ r: EdgeProps<S, E>; fromId: string; toId: string }>(
      compiled.query, compiled.params,
    )
    const result = results[0]

    if (!result) {
      throw new EdgeNotFoundError(edge as string, from, to)
    }

    return { id: result.r.id, from: result.fromId, to: result.toId, data: result.r as any }
  }

  async unlink<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
  ): Promise<DeleteResult> {
    await this.hooksRunner.runBeforeUnlink(edge, from, to)

    const op = ops.deleteEdge(edge as string, from, to)
    const compiled = this.runPipeline(op)

    const results = await this.executor.run<{ deleted: boolean }>(compiled.query, compiled.params)
    const deleteResult: DeleteResult = { deleted: results[0]?.deleted ?? false, id: `${from}->${to}` }

    await this.hooksRunner.runAfterUnlink(deleteResult)
    return deleteResult
  }

  async unlinkById<E extends EdgeTypes<S>>(
    edge: E,
    edgeId: string,
  ): Promise<DeleteResult> {
    const op = ops.deleteEdgeById(edge as string, edgeId)
    const compiled = this.runPipeline(op)

    const results = await this.executor.run<{ deleted: boolean }>(compiled.query, compiled.params)
    return { deleted: results[0]?.deleted ?? false, id: edgeId }
  }

  async patchLinkById<E extends EdgeTypes<S>>(
    edge: E,
    edgeId: string,
    data: Partial<EdgeInput<S, E, T>>,
  ): Promise<EdgeResult<S, E, T>> {
    let validatedData: Record<string, unknown>
    if (this.validationOptions.enabled && this.validationOptions.onUpdate) {
      validatedData = this.validator.parseAndPrepareEdge(edge, data, true) ?? {}
    } else {
      validatedData = stripUndefined(data as Record<string, unknown>)
    }

    const dbReadyData = serializeDates(validatedData)
    const op = ops.updateEdgeById(edge as string, edgeId, dbReadyData)
    const compiled = this.runPipeline(op)

    const results = await this.executor.run<{ r: EdgeProps<S, E>; fromId: string; toId: string }>(
      compiled.query, compiled.params,
    )
    const result = results[0]

    if (!result) {
      throw new Error(`Edge not found: ${edge} with id ${edgeId}`)
    }

    return { id: edgeId, from: result.fromId, to: result.toId, data: result.r as any }
  }

  // ---------------------------------------------------------------------------
  // HIERARCHY OPERATIONS
  // ---------------------------------------------------------------------------

  async createChild<N extends NodeLabels<S>>(
    label: N,
    parentId: string,
    data: NodeInput<S, N, T>,
    options?: HierarchyOptions<S>,
  ): Promise<NodeResult<S, N, T>> {
    const edgeType = this.resolveHierarchyEdge(options?.edge)
    const id = this.idGenerator.generate(label as string) as string

    const op = ops.createNode(label as string, id, data as Record<string, unknown>, {
      links: [{ edgeType, targetId: parentId }],
    })
    const compiled = this.runPipeline(op)

    const results = await this.executor.run<{ n: NodeProps<S, N> }>(compiled.query, compiled.params)
    const result = results[0]

    if (!result) {
      throw new ParentNotFoundError(parentId)
    }

    return { id, data: result.n as any }
  }

  async move(
    nodeId: string,
    newParentId: string,
    options?: HierarchyOptions<S>,
  ): Promise<MoveResult> {
    const edgeType = this.resolveHierarchyEdge(options?.edge)

    // Build op and run through pipeline (pass may rewrite edge type)
    const op = ops.moveNode(nodeId, newParentId, edgeType)
    const transformedOps = this.pipeline.run(op, this.schema)
    const moveOp = transformedOps[0]! as import('./ast/types').MoveNodeOp

    // Cycle check
    const cycleCheck = this.compiler.compileCycleCheck(moveOp)
    const cycleResults = await this.executor.run<{ wouldCycle: boolean }>(
      cycleCheck.query, cycleCheck.params,
    )
    if (cycleResults[0]?.wouldCycle) {
      throw new CycleDetectedError(nodeId, newParentId)
    }

    // Try move (node has existing parent)
    const moveCompiled = this.compiler.compileMove(moveOp)
    let results = await this.executor.run<{
      nodeId: string; previousParentId: string | null; newParentId: string
    }>(moveCompiled.query, moveCompiled.params)

    // Orphan fallback
    if (results.length === 0) {
      const orphanCompiled = this.compiler.compileMoveOrphan(moveOp)
      results = await this.executor.run<{
        nodeId: string; previousParentId: string | null; newParentId: string
      }>(orphanCompiled.query, orphanCompiled.params)
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
    await this.move(rootId, newParentId, options)

    const edgeType = this.resolveHierarchyEdge(options?.edge)
    const subtreeCompiled = this.compiler.compileGetSubtree(rootId, edgeType)
    const countResults = await this.executor.run<{ node: unknown; depth: number }>(
      subtreeCompiled.query, subtreeCompiled.params,
    )

    return { rootId, affectedNodes: countResults.length }
  }

  async clone<N extends NodeLabels<S>>(
    label: N,
    sourceId: string,
    overrides?: Partial<NodeInput<S, N, T>>,
    options?: CloneOptions<S>,
  ): Promise<NodeResult<S, N, T>> {
    const newId = this.idGenerator.generate(label as string) as string

    let parent: import('./ast/types').CloneNodeOp['parent']
    if (options?.parentId) {
      parent = { parentId: options.parentId, edgeType: this.resolveHierarchyEdge(options.edge) }
    } else if (options?.preserveParent) {
      parent = { preserve: true, edgeType: this.resolveHierarchyEdge(options.edge) }
    }

    const op = ops.cloneNode(
      label as string, sourceId, newId, (overrides ?? {}) as Record<string, unknown>, parent,
    )
    const compiled = this.runPipeline(op)

    const results = await this.executor.run<{ clone: NodeProps<S, N> }>(compiled.query, compiled.params)
    const result = results[0]

    if (!result) {
      throw new SourceNotFoundError(label as string, sourceId)
    }

    return { id: newId, data: result.clone as any }
  }

  async cloneSubtree(
    sourceRootId: string,
    options?: CloneSubtreeOptions<S, T>,
  ): Promise<CloneSubtreeResult<S, NodeLabels<S>, T>> {
    const edgeType = this.resolveHierarchyEdge(options?.edge)

    const subtreeCompiled = this.compiler.compileGetSubtree(sourceRootId, edgeType)
    const subtreeNodes = await this.executor.run<{
      node: NodeProps<S, NodeLabels<S>>; depth: number; nodeLabels: string[]
    }>(subtreeCompiled.query, subtreeCompiled.params)

    if (subtreeNodes.length === 0) {
      throw new SourceNotFoundError('node', sourceRootId)
    }

    const nodesToClone = options?.maxDepth !== undefined
      ? subtreeNodes.filter((n) => n.depth <= options.maxDepth!)
      : subtreeNodes

    const idMapping: Record<string, string> = {}
    const labelsMapping: Record<string, string[]> = {}
    for (const { node, nodeLabels } of nodesToClone) {
      idMapping[node.id] = this.idGenerator.generate(nodeLabels[0]!) as string
      labelsMapping[node.id] = nodeLabels
    }

    const rootResult = await this.executor.runInTransaction(async (tx) => {
      let clonedRoot: NodeResult<S, NodeLabels<S>, T> | null = null

      for (const { node, depth } of nodesToClone) {
        const newId = idMapping[node.id]
        const nodeLabels = labelsMapping[node.id]
        if (!newId || !nodeLabels) continue

        const { id: _id, ...nodeData } = node

        let finalData = nodeData as NodeInput<S, NodeLabels<S>>
        if (options?.transform) {
          const transformed = options.transform(node as any, depth)
          finalData = { ...finalData, ...transformed }
        }

        // Build and compile through pipeline
        const cloneOp = ops.createNode(nodeLabels[0]!, newId, finalData as Record<string, unknown>, {
          additionalLabels: nodeLabels.slice(1),
        })
        const compiled = this.runPipeline(cloneOp)
        const results = await tx.run<{ n: NodeProps<S, NodeLabels<S>> }>(compiled.query, compiled.params)
        const result = results[0]

        if (result && depth === 0) {
          clonedRoot = { id: newId, data: result.n as any }
        }

        // Re-create parent edge within the clone tree
        if (depth > 0) {
          const parentOfOriginal = nodesToClone.find(
            (p) => p.depth === depth - 1 && subtreeNodes.indexOf(p) < subtreeNodes.indexOf({ node, depth, nodeLabels: nodeLabels! }),
          )
          if (parentOfOriginal) {
            const parentNewId = idMapping[parentOfOriginal.node.id]
            if (parentNewId) {
              const linkOp = ops.createEdge(edgeType, newId, parentNewId, this.idGenerator.generate(edgeType))
              const linkCompiled = this.runPipeline(linkOp)
              await tx.run(linkCompiled.query, linkCompiled.params)
            }
          }
        }
      }

      // Link root to parent if requested
      if (clonedRoot && options?.parentId) {
        const linkOp = ops.createEdge(
          edgeType, clonedRoot.id, options.parentId,
          this.idGenerator.generate(edgeType),
        )
        const linkCompiled = this.runPipeline(linkOp)
        await tx.run(linkCompiled.query, linkCompiled.params)
      }

      return clonedRoot
    })

    if (!rootResult) {
      throw new Error('Failed to clone subtree: no root created')
    }

    return { root: rootResult, clonedNodes: nodesToClone.length, idMapping }
  }

  async deleteSubtree<N extends NodeLabels<S>>(
    _label: N,
    rootId: string,
    options?: HierarchyOptions<S>,
  ): Promise<DeleteSubtreeResult> {
    const edgeType = this.resolveHierarchyEdge(options?.edge)

    const op = ops.deleteSubtree(rootId, edgeType)
    const compiled = this.runPipeline(op)

    const results = await this.executor.run<{ deletedNodes: number }>(compiled.query, compiled.params)

    return { rootId, deletedNodes: results[0]?.deletedNodes ?? 0, deletedEdges: 0 }
  }

  // ---------------------------------------------------------------------------
  // BATCH OPERATIONS
  // ---------------------------------------------------------------------------

  async createMany<N extends NodeLabels<S>>(
    label: N,
    items: NodeInput<S, N, T>[],
    options?: CreateOptions,
  ): Promise<NodeResult<S, N, T>[]> {
    const itemsWithIds: { id: string; data: Record<string, unknown> }[] = []

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      let validatedData: Record<string, unknown>
      if (this.validationOptions.enabled && this.validationOptions.onCreate) {
        try {
          validatedData = this.validator.parseAndPrepareNode(label, item)
        } catch (error) {
          if (error instanceof ValidationError) {
            throw new ValidationError(
              `Batch validation failed at index ${i}: ${error.message}`,
              error.field, error.expected, error.received,
            )
          }
          throw error
        }
      } else {
        validatedData = stripUndefined(item as Record<string, unknown>)
      }

      itemsWithIds.push({
        id: (options?.id ?? this.idGenerator.generate(label as string)) as string,
        props: serializeDates(validatedData),
      } as unknown as { id: string; data: Record<string, unknown> })
    }

    const op = ops.batchCreate(label as string, itemsWithIds, {
      additionalLabels: options?.additionalLabels,
    })
    const compiled = this.runPipeline(op)

    const results = await this.executor.run<{ n: NodeProps<S, N> }>(compiled.query, compiled.params)

    return results.map((r, i) => ({
      id: itemsWithIds[i]!.id,
      data: this.deserializeDates(label, r.n) as any,
    }))
  }

  async updateMany<N extends NodeLabels<S>>(
    label: N,
    updates: Array<{ id: string; data: Partial<NodeInput<S, N, T>> }>,
  ): Promise<NodeResult<S, N, T>[]> {
    const updateItems = updates.map((u, i) => {
      let validatedData: Record<string, unknown>
      if (this.validationOptions.enabled && this.validationOptions.onUpdate) {
        try {
          validatedData = this.validator.parseAndPrepareNode(label, u.data, true)
        } catch (error) {
          if (error instanceof ValidationError) {
            throw new ValidationError(
              `Batch update validation failed at index ${i}: ${error.message}`,
              error.field, error.expected, error.received,
            )
          }
          throw error
        }
      } else {
        validatedData = stripUndefined(u.data as Record<string, unknown>)
      }
      return { id: u.id, data: serializeDates(validatedData) }
    })

    const op = ops.batchUpdate(label as string, updateItems)
    const compiled = this.runPipeline(op)

    const results = await this.executor.run<{ n: NodeProps<S, N> }>(compiled.query, compiled.params)

    return results.map((r) => ({
      id: r.n.id as string,
      data: r.n as any,
    }))
  }

  async deleteMany<N extends NodeLabels<S>>(
    label: N,
    ids: Array<string>,
    _options?: DeleteOptions,
  ): Promise<BatchDeleteResult> {
    const op = ops.batchDelete(label as string, ids)
    const compiled = this.runPipeline(op)

    const results = await this.executor.run<{ deletedCount: number }>(compiled.query, compiled.params)
    return { deleted: results[0]?.deletedCount ?? 0 }
  }

  async linkMany<E extends EdgeTypes<S>>(
    edge: E,
    links: LinkInput<S, E, T>[],
  ): Promise<EdgeResult<S, E, T>[]> {
    if (links.length === 0) return []

    const linksWithIds = links.map((link) => ({
      fromId: link.from,
      toId: link.to,
      data: (link.data ?? {}) as Record<string, unknown>,
      edgeId: this.idGenerator.generate(edge as string),
    }))

    // BatchLinkOp expects from/to fields for the UNWIND template
    const batchLinks = linksWithIds.map((l) => ({
      fromId: l.fromId,
      toId: l.toId,
      edgeId: l.edgeId,
      data: l.data,
    }))

    const op = ops.batchLink(edge as string, batchLinks)
    const compiled = this.runPipeline(op)

    const results = await this.executor.run<{ r: EdgeProps<S, E>; fromId: string; toId: string }>(
      compiled.query, compiled.params,
    )

    return results.map((r, i) => ({
      id: linksWithIds[i]?.edgeId ?? '',
      from: r.fromId,
      to: r.toId,
      data: r.r as any,
    }))
  }

  async unlinkMany<E extends EdgeTypes<S>>(
    edge: E,
    links: Array<{ from: string; to: string }>,
  ): Promise<BatchDeleteResult> {
    if (links.length === 0) return { deleted: 0 }

    const batchLinks = links.map((l) => ({ fromId: l.from, toId: l.to }))
    const op = ops.batchUnlink(edge as string, batchLinks)
    const compiled = this.runPipeline(op)

    const results = await this.executor.run<{ deleted: number }>(compiled.query, compiled.params)
    return { deleted: results[0]?.deleted ?? 0 }
  }

  async unlinkAllFrom<E extends EdgeTypes<S>>(edge: E, from: string): Promise<BatchDeleteResult> {
    const op = ops.unlinkAllFrom(edge as string, from)
    const compiled = this.runPipeline(op)

    const results = await this.executor.run<{ deleted: number }>(compiled.query, compiled.params)
    return { deleted: results[0]?.deleted ?? 0 }
  }

  async unlinkAllTo<E extends EdgeTypes<S>>(edge: E, to: string): Promise<BatchDeleteResult> {
    const op = ops.unlinkAllTo(edge as string, to)
    const compiled = this.runPipeline(op)

    const results = await this.executor.run<{ deleted: number }>(compiled.query, compiled.params)
    return { deleted: results[0]?.deleted ?? 0 }
  }

  // ---------------------------------------------------------------------------
  // EXEC (user-composed multi-mutations)
  // ---------------------------------------------------------------------------

  async exec(userOps: MutationOp[]): Promise<Record<string, unknown>[]> {
    const validatedOps = this.validationOptions.enabled
      ? this.validator.validateAndPrepareOps(userOps)
      : userOps

    const transformed = this.pipeline.run(validatedOps, this.schema)
    const compiled = this.compiler.compile(transformed, this.schema)
    return this.executor.run(compiled.query, compiled.params)
  }

  // ---------------------------------------------------------------------------
  // TRANSACTIONS
  // ---------------------------------------------------------------------------

  async transaction<R>(fn: (tx: MutationTransaction<S, T>) => Promise<R>): Promise<R> {
    return this.executor.runInTransaction(async (runner) => {
      const txContext = new MutationTransactionImpl<S, T>(
        this.schema, runner, this.idGenerator, this.pipeline, this.compiler,
        this.validator, this.validationOptions,
      )
      return fn(txContext)
    })
  }

  // ---------------------------------------------------------------------------
  // RAW QUERIES
  // ---------------------------------------------------------------------------

  async raw<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
    return this.executor.run<T>(cypher, params ?? {})
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  private runPipeline(op: MutationOp): CompiledMutation {
    const transformed = this.pipeline.run(op, this.schema)
    return this.compiler.compile(transformed, this.schema)
  }

  private resolveHierarchyEdge(edge?: EdgeTypes<S>): string {
    if (edge) return edge as string
    const hierarchy = this.schema.hierarchy
    if (!hierarchy?.defaultEdge) {
      throw new Error('No hierarchy edge specified and schema has no default hierarchy configuration')
    }
    return hierarchy.defaultEdge
  }

  private deserializeDates<N extends NodeLabels<S>>(
    label: N,
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    return deserializeDateFields(this.schema, label as string, data)
  }
}

// =============================================================================
// MUTATION TRANSACTION IMPLEMENTATION
// =============================================================================

class MutationTransactionImpl<S extends SchemaShape, T extends TypeMap = UntypedMap> implements MutationTransaction<S, T> {
  private readonly schema: S
  private readonly runner: TransactionRunner
  private readonly idGenerator: IdGenerator
  private readonly pipeline: MutationCompilationPipeline
  private readonly compiler: MutationCypherCompiler
  private readonly validator: MutationValidator<S>
  private readonly validationOptions: Required<Omit<ValidationOptions, 'validators'>>

  constructor(
    schema: S,
    runner: TransactionRunner,
    idGenerator: IdGenerator,
    pipeline: MutationCompilationPipeline,
    compiler: MutationCypherCompiler,
    validator: MutationValidator<S>,
    validationOptions: Required<Omit<ValidationOptions, 'validators'>>,
  ) {
    this.schema = schema
    this.runner = runner
    this.idGenerator = idGenerator
    this.pipeline = pipeline
    this.compiler = compiler
    this.validator = validator
    this.validationOptions = validationOptions
  }

  private runPipeline(op: MutationOp): CompiledMutation {
    const transformed = this.pipeline.run(op, this.schema)
    return this.compiler.compile(transformed, this.schema)
  }

  async create<N extends NodeLabels<S>>(
    label: N,
    data: NodeInput<S, N, T>,
    options?: CreateOptions,
  ): Promise<NodeResult<S, N, T>> {
    const id = (options?.id ?? this.idGenerator.generate(label as string)) as string

    let validatedData: Record<string, unknown>
    if (this.validationOptions.enabled && this.validationOptions.onCreate) {
      validatedData = this.validator.parseAndPrepareNode(label, data)
    } else {
      validatedData = stripUndefined(data as Record<string, unknown>)
    }
    const dbReadyData = serializeDates(validatedData)

    const links = options?.link
      ? Object.entries(options.link).map(([edgeType, targetId]) => {
          if (targetId == null || targetId === '') {
            throw new Error(
              `Invalid link target for edge type '${edgeType}': expected a node ID or 'self', got ${JSON.stringify(targetId)}`,
            )
          }
          return { edgeType, targetId: targetId === 'self' ? id : targetId }
        })
      : undefined

    const op = ops.createNode(label as string, id, dbReadyData, {
      additionalLabels: options?.additionalLabels,
      links,
    })
    const compiled = this.runPipeline(op)

    const results = await this.runner.run<{ n: NodeProps<S, N> }>(compiled.query, compiled.params)
    const result = results[0]

    if (!result) {
      if (options?.link && Object.keys(options.link).length > 0) {
        throw new Error(
          `Failed to create node '${String(label)}': one or more link targets not found. Links: ${JSON.stringify(options.link)}`,
        )
      }
      throw new Error(`Failed to create node: ${label}`)
    }

    return { id, data: result.n as any }
  }

  async update<N extends NodeLabels<S>>(
    label: N,
    id: string,
    data: Partial<NodeInput<S, N, T>>,
  ): Promise<NodeResult<S, N, T>> {
    let validatedData: Record<string, unknown>
    if (this.validationOptions.enabled && this.validationOptions.onUpdate) {
      validatedData = this.validator.parseAndPrepareNode(label, data, true)
    } else {
      validatedData = stripUndefined(data as Record<string, unknown>)
    }
    const dbReadyData = serializeDates(validatedData)

    const op = ops.updateNode(label as string, id, dbReadyData)
    const compiled = this.runPipeline(op)

    const results = await this.runner.run<{ n: NodeProps<S, N> }>(compiled.query, compiled.params)
    const result = results[0]

    if (!result) {
      throw new NodeNotFoundError(label as string, id)
    }

    return { id, data: result.n as any }
  }

  async delete<N extends NodeLabels<S>>(
    label: N,
    id: string,
    options?: DeleteOptions,
  ): Promise<DeleteResult> {
    const detach = options?.detach ?? true

    const op = ops.deleteNode(label as string, id, detach)
    const compiled = this.runPipeline(op)

    const results = await this.runner.run<{ deleted: boolean }>(compiled.query, compiled.params)
    return { deleted: results[0]?.deleted ?? false, id }
  }

  async upsert<N extends NodeLabels<S>>(
    label: N,
    id: string,
    data: NodeInput<S, N, T>,
  ): Promise<UpsertResult<S, N, T>> {
    let validatedData: Record<string, unknown>
    if (this.validationOptions.enabled && this.validationOptions.onCreate) {
      validatedData = this.validator.parseAndPrepareNode(label, data)
    } else {
      validatedData = stripUndefined(data as Record<string, unknown>)
    }
    const dbReadyData = serializeDates(validatedData)

    const op = ops.upsertNode(label as string, id, dbReadyData)
    const compiled = this.runPipeline(op)

    const results = await this.runner.run<{ n: NodeProps<S, N>; created: boolean }>(
      compiled.query, compiled.params,
    )
    const result = results[0]

    if (!result) {
      throw new Error(`Failed to upsert node: ${label}`)
    }

    return { id, data: result.n as any, created: result.created }
  }

  async link<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
    data?: EdgeInput<S, E, T>,
  ): Promise<EdgeResult<S, E, T>> {
    const edgeId = this.idGenerator.generate(edge as string)

    let validatedEdgeData: Record<string, unknown> | undefined
    if (this.validationOptions.enabled && this.validationOptions.onCreate && data) {
      validatedEdgeData = this.validator.parseAndPrepareEdge(edge, data)
    } else if (data) {
      validatedEdgeData = stripUndefined(data as Record<string, unknown>)
    }

    const dbReadyEdgeData = validatedEdgeData
      ? serializeDates(validatedEdgeData)
      : undefined

    const op = ops.createEdge(
      edge as string, from, to, edgeId, dbReadyEdgeData,
    )
    const compiled = this.runPipeline(op)

    const results = await this.runner.run<{ r: EdgeProps<S, E>; fromId: string; toId: string }>(
      compiled.query, compiled.params,
    )
    const result = results[0]

    if (!result) {
      throw new Error(`Failed to create edge: ${edge} from ${from} to ${to}`)
    }

    return { id: edgeId, from: result.fromId, to: result.toId, data: result.r as any }
  }

  async patchLink<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
    data: Partial<EdgeInput<S, E, T>>,
  ): Promise<EdgeResult<S, E, T>> {
    let validatedData: Record<string, unknown>
    if (this.validationOptions.enabled && this.validationOptions.onUpdate) {
      validatedData = this.validator.parseAndPrepareEdge(edge, data, true) ?? {}
    } else {
      validatedData = stripUndefined(data as Record<string, unknown>)
    }

    const dbReadyData = serializeDates(validatedData)
    const op = ops.updateEdge(edge as string, from, to, dbReadyData)
    const compiled = this.runPipeline(op)

    const results = await this.runner.run<{ r: EdgeProps<S, E>; fromId: string; toId: string }>(
      compiled.query, compiled.params,
    )
    const result = results[0]

    if (!result) {
      throw new EdgeNotFoundError(edge as string, from, to)
    }

    return { id: result.r.id, from: result.fromId, to: result.toId, data: result.r as any }
  }

  async unlink<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
  ): Promise<DeleteResult> {
    const op = ops.deleteEdge(edge as string, from, to)
    const compiled = this.runPipeline(op)

    const results = await this.runner.run<{ deleted: boolean }>(compiled.query, compiled.params)
    return { deleted: results[0]?.deleted ?? false, id: `${from}->${to}` }
  }

  async linkMany<E extends EdgeTypes<S>>(
    edge: E,
    links: LinkInput<S, E, T>[],
  ): Promise<EdgeResult<S, E, T>[]> {
    if (links.length === 0) return []

    const batchLinks = links.map((link, i) => {
      let validatedData: Record<string, unknown> | undefined
      if (this.validationOptions.enabled && this.validationOptions.onCreate && link.data) {
        try {
          validatedData = this.validator.parseAndPrepareEdge(edge, link.data)
        } catch (error) {
          if (error instanceof ValidationError) {
            throw new ValidationError(
              `Batch link validation failed at index ${i}: ${error.message}`,
              error.field, error.expected, error.received,
            )
          }
          throw error
        }
      } else if (link.data) {
        validatedData = stripUndefined(link.data as Record<string, unknown>)
      }

      return {
        fromId: link.from,
        toId: link.to,
        edgeId: this.idGenerator.generate(edge as string),
        data: validatedData ? serializeDates(validatedData) : {},
      }
    })

    const op = ops.batchLink(edge as string, batchLinks)
    const compiled = this.runPipeline(op)

    const results = await this.runner.run<{ r: EdgeProps<S, E>; fromId: string; toId: string }>(
      compiled.query, compiled.params,
    )

    return results.map((r, i) => ({
      id: batchLinks[i]?.edgeId ?? '',
      from: r.fromId,
      to: r.toId,
      data: r.r as any,
    }))
  }

  async unlinkMany<E extends EdgeTypes<S>>(
    edge: E,
    links: Array<{ from: string; to: string }>,
  ): Promise<BatchDeleteResult> {
    if (links.length === 0) return { deleted: 0 }

    const batchLinks = links.map((l) => ({ fromId: l.from, toId: l.to }))
    const op = ops.batchUnlink(edge as string, batchLinks)
    const compiled = this.runPipeline(op)

    const results = await this.runner.run<{ deleted: number }>(compiled.query, compiled.params)
    return { deleted: results[0]?.deleted ?? 0 }
  }

  async createChild<N extends NodeLabels<S>>(
    label: N,
    parentId: string,
    data: NodeInput<S, N, T>,
    options?: HierarchyOptions<S>,
  ): Promise<NodeResult<S, N, T>> {
    const edgeType = this.resolveHierarchyEdge(options?.edge)
    const id = this.idGenerator.generate(label as string) as string

    let validatedData: Record<string, unknown>
    if (this.validationOptions.enabled && this.validationOptions.onCreate) {
      validatedData = this.validator.parseAndPrepareNode(label, data)
    } else {
      validatedData = stripUndefined(data as Record<string, unknown>)
    }
    const dbReadyData = serializeDates(validatedData)

    const op = ops.createNode(label as string, id, dbReadyData, {
      links: [{ edgeType, targetId: parentId }],
    })
    const compiled = this.runPipeline(op)

    const results = await this.runner.run<{ n: NodeProps<S, N> }>(compiled.query, compiled.params)
    const result = results[0]

    if (!result) {
      throw new ParentNotFoundError(parentId)
    }

    return { id, data: result.n as any }
  }

  async move(
    nodeId: string,
    newParentId: string,
    options?: HierarchyOptions<S>,
  ): Promise<MoveResult> {
    const edgeType = this.resolveHierarchyEdge(options?.edge)

    const op = ops.moveNode(nodeId, newParentId, edgeType)
    const transformedOps = this.pipeline.run(op, this.schema)
    const moveOp = transformedOps[0]! as import('./ast/types').MoveNodeOp

    const moveCompiled = this.compiler.compileMove(moveOp)
    let results = await this.runner.run<{
      nodeId: string; previousParentId: string | null; newParentId: string
    }>(moveCompiled.query, moveCompiled.params)

    if (results.length === 0) {
      const orphanCompiled = this.compiler.compileMoveOrphan(moveOp)
      results = await this.runner.run<{
        nodeId: string; previousParentId: string | null; newParentId: string
      }>(orphanCompiled.query, orphanCompiled.params)
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

  async raw<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
    return this.runner.run<T>(cypher, params ?? {})
  }

  private resolveHierarchyEdge(edge?: EdgeTypes<S>): string {
    if (edge) return edge as string
    const hierarchy = (this.schema as { hierarchy?: { defaultEdge?: string } }).hierarchy
    if (!hierarchy?.defaultEdge) {
      throw new Error('No hierarchy edge specified and schema has no default hierarchy configuration')
    }
    return hierarchy.defaultEdge
  }
}
