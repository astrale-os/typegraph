/**
 * Mutation Hooks / Middleware
 *
 * Lifecycle hooks for mutation operations.
 * Allows intercepting and modifying mutations at various stages.
 */

import type { AnySchema, NodeLabels, EdgeTypes } from '../schema'
import type { NodeInput, EdgeInput, NodeResult, EdgeResult, DeleteResult } from './types'

// =============================================================================
// HOOK CONTEXT
// =============================================================================

/**
 * Context passed to mutation hooks.
 */
export interface MutationContext<S extends AnySchema> {
  /** The schema definition */
  schema: S
  /** Operation being performed */
  operation: MutationOperation
  /** Timestamp when mutation started */
  timestamp: Date
  /** Optional metadata attached to this mutation */
  meta?: Record<string, unknown>
}

export type MutationOperation =
  | 'create'
  | 'update'
  | 'delete'
  | 'link'
  | 'patchLink'
  | 'unlink'
  | 'createChild'
  | 'move'
  | 'clone'
  | 'cloneSubtree'
  | 'deleteSubtree'

// =============================================================================
// HOOK TYPES
// =============================================================================

/**
 * Hook called before creating a node.
 * Can modify data or throw to abort.
 */
export type BeforeCreateHook<S extends AnySchema> = <N extends NodeLabels<S>>(
  label: N,
  data: NodeInput<S, N>,
  ctx: MutationContext<S>,
) => NodeInput<S, N> | Promise<NodeInput<S, N>> | void | Promise<void>

/**
 * Hook called after creating a node.
 */
export type AfterCreateHook<S extends AnySchema> = <N extends NodeLabels<S>>(
  result: NodeResult<S, N>,
  ctx: MutationContext<S>,
) => void | Promise<void>

/**
 * Hook called before updating a node.
 */
export type BeforeUpdateHook<S extends AnySchema> = <N extends NodeLabels<S>>(
  label: N,
  id: string,
  data: Partial<NodeInput<S, N>>,
  ctx: MutationContext<S>,
) => Partial<NodeInput<S, N>> | Promise<Partial<NodeInput<S, N>>> | void | Promise<void>

/**
 * Hook called after updating a node.
 */
export type AfterUpdateHook<S extends AnySchema> = <N extends NodeLabels<S>>(
  result: NodeResult<S, N>,
  ctx: MutationContext<S>,
) => void | Promise<void>

/**
 * Hook called before deleting a node.
 * Can throw to abort.
 */
export type BeforeDeleteHook<S extends AnySchema> = <N extends NodeLabels<S>>(
  label: N,
  id: string,
  ctx: MutationContext<S>,
) => void | Promise<void>

/**
 * Hook called after deleting a node.
 */
export type AfterDeleteHook<S extends AnySchema> = (
  result: DeleteResult,
  ctx: MutationContext<S>,
) => void | Promise<void>

/**
 * Hook called before creating an edge.
 */
export type BeforeLinkHook<S extends AnySchema> = <E extends EdgeTypes<S>>(
  edge: E,
  from: string,
  to: string,
  data: EdgeInput<S, E> | undefined,
  ctx: MutationContext<S>,
) => EdgeInput<S, E> | undefined | Promise<EdgeInput<S, E> | undefined> | void | Promise<void>

/**
 * Hook called after creating an edge.
 */
export type AfterLinkHook<S extends AnySchema> = <E extends EdgeTypes<S>>(
  result: EdgeResult<S, E>,
  ctx: MutationContext<S>,
) => void | Promise<void>

/**
 * Hook called before deleting an edge.
 */
export type BeforeUnlinkHook<S extends AnySchema> = <E extends EdgeTypes<S>>(
  edge: E,
  from: string,
  to: string,
  ctx: MutationContext<S>,
) => void | Promise<void>

/**
 * Hook called after deleting an edge.
 */
export type AfterUnlinkHook<S extends AnySchema> = (
  result: DeleteResult,
  ctx: MutationContext<S>,
) => void | Promise<void>

// =============================================================================
// HOOKS CONFIGURATION
// =============================================================================

/**
 * All available mutation hooks.
 */
export interface MutationHooks<S extends AnySchema> {
  // Node lifecycle
  beforeCreate?: BeforeCreateHook<S> | BeforeCreateHook<S>[]
  afterCreate?: AfterCreateHook<S> | AfterCreateHook<S>[]
  beforeUpdate?: BeforeUpdateHook<S> | BeforeUpdateHook<S>[]
  afterUpdate?: AfterUpdateHook<S> | AfterUpdateHook<S>[]
  beforeDelete?: BeforeDeleteHook<S> | BeforeDeleteHook<S>[]
  afterDelete?: AfterDeleteHook<S> | AfterDeleteHook<S>[]

  // Edge lifecycle
  beforeLink?: BeforeLinkHook<S> | BeforeLinkHook<S>[]
  afterLink?: AfterLinkHook<S> | AfterLinkHook<S>[]
  beforeUnlink?: BeforeUnlinkHook<S> | BeforeUnlinkHook<S>[]
  afterUnlink?: AfterUnlinkHook<S> | AfterUnlinkHook<S>[]
}

// =============================================================================
// HOOKS RUNNER
// =============================================================================

/**
 * Runs mutation hooks in sequence.
 */
export class HooksRunner<S extends AnySchema> {
  private readonly hooks: MutationHooks<S>
  private readonly schema: S

  constructor(schema: S, hooks: MutationHooks<S> = {}) {
    this.schema = schema
    this.hooks = hooks
  }

  private createContext(
    operation: MutationOperation,
    meta?: Record<string, unknown>,
  ): MutationContext<S> {
    return {
      schema: this.schema,
      operation,
      timestamp: new Date(),
      meta,
    }
  }

  private toArray<T>(hook: T | T[] | undefined): T[] {
    if (!hook) return []
    return Array.isArray(hook) ? hook : [hook]
  }

  // Node hooks

  async runBeforeCreate<N extends NodeLabels<S>>(
    label: N,
    data: NodeInput<S, N>,
    meta?: Record<string, unknown>,
  ): Promise<NodeInput<S, N>> {
    const ctx = this.createContext('create', meta)
    let result = data

    for (const hook of this.toArray(this.hooks.beforeCreate)) {
      const modified = await hook(label, result, ctx)
      if (modified !== undefined && modified !== null) {
        result = modified as NodeInput<S, N>
      }
    }

    return result
  }

  async runAfterCreate<N extends NodeLabels<S>>(
    result: NodeResult<S, N>,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    const ctx = this.createContext('create', meta)
    for (const hook of this.toArray(this.hooks.afterCreate)) {
      await hook(result, ctx)
    }
  }

  async runBeforeUpdate<N extends NodeLabels<S>>(
    label: N,
    id: string,
    data: Partial<NodeInput<S, N>>,
    meta?: Record<string, unknown>,
  ): Promise<Partial<NodeInput<S, N>>> {
    const ctx = this.createContext('update', meta)
    let result = data

    for (const hook of this.toArray(this.hooks.beforeUpdate)) {
      const modified = await hook(label, id, result, ctx)
      if (modified !== undefined && modified !== null) {
        result = modified as Partial<NodeInput<S, N>>
      }
    }

    return result
  }

  async runAfterUpdate<N extends NodeLabels<S>>(
    result: NodeResult<S, N>,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    const ctx = this.createContext('update', meta)
    for (const hook of this.toArray(this.hooks.afterUpdate)) {
      await hook(result, ctx)
    }
  }

  async runBeforeDelete<N extends NodeLabels<S>>(
    label: N,
    id: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    const ctx = this.createContext('delete', meta)
    for (const hook of this.toArray(this.hooks.beforeDelete)) {
      await hook(label, id, ctx)
    }
  }

  async runAfterDelete(result: DeleteResult, meta?: Record<string, unknown>): Promise<void> {
    const ctx = this.createContext('delete', meta)
    for (const hook of this.toArray(this.hooks.afterDelete)) {
      await hook(result, ctx)
    }
  }

  // Edge hooks

  async runBeforeLink<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
    data: EdgeInput<S, E> | undefined,
    meta?: Record<string, unknown>,
  ): Promise<EdgeInput<S, E> | undefined> {
    const ctx = this.createContext('link', meta)
    let result = data

    for (const hook of this.toArray(this.hooks.beforeLink)) {
      const modified = await hook(edge, from, to, result, ctx)
      if (modified !== undefined) {
        result = modified as EdgeInput<S, E> | undefined
      }
    }

    return result
  }

  async runAfterLink<E extends EdgeTypes<S>>(
    result: EdgeResult<S, E>,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    const ctx = this.createContext('link', meta)
    for (const hook of this.toArray(this.hooks.afterLink)) {
      await hook(result, ctx)
    }
  }

  async runBeforeUnlink<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    const ctx = this.createContext('unlink', meta)
    for (const hook of this.toArray(this.hooks.beforeUnlink)) {
      await hook(edge, from, to, ctx)
    }
  }

  async runAfterUnlink(result: DeleteResult, meta?: Record<string, unknown>): Promise<void> {
    const ctx = this.createContext('unlink', meta)
    for (const hook of this.toArray(this.hooks.afterUnlink)) {
      await hook(result, ctx)
    }
  }
}
