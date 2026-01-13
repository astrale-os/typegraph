/**
 * Dry Run Mode
 *
 * Execute mutations without persisting to database.
 * Useful for validation, debugging, and testing.
 */

import type { AnySchema, NodeLabels, EdgeTypes, NodeProps, EdgeProps } from "../schema"
import type {
  NodeInput,
  EdgeInput,
  NodeResult,
  EdgeResult,
  DeleteResult,
  CreateOptions,
  HierarchyOptions,
  IdGenerator,
} from "./types"

// =============================================================================
// DRY RUN RESULT
// =============================================================================

/**
 * Result of a dry-run mutation.
 * Contains the query that would be executed and the parameters.
 */
export interface DryRunResult<T = unknown> {
  /** The query that would be executed */
  query: string
  /** Parameters that would be passed */
  params: Record<string, unknown>
  /** Simulated result (if predictable) */
  simulatedResult?: T
  /** Validation errors (if any) */
  validationErrors?: DryRunValidationError[]
  /** Warnings (non-blocking issues) */
  warnings?: string[]
}

export interface DryRunValidationError {
  field: string
  message: string
  code: string
}

// =============================================================================
// DRY RUN COLLECTOR
// =============================================================================

/**
 * Collects dry-run results for batch inspection.
 */
export class DryRunCollector {
  private readonly results: DryRunResult[] = []

  add<T>(result: DryRunResult<T>): void {
    this.results.push(result)
  }

  getAll(): DryRunResult[] {
    return [...this.results]
  }

  getQueries(): string[] {
    return this.results.map((r) => r.query)
  }

  hasErrors(): boolean {
    return this.results.some((r) => r.validationErrors && r.validationErrors.length > 0)
  }

  getErrors(): DryRunValidationError[] {
    return this.results.flatMap((r) => r.validationErrors ?? [])
  }

  clear(): void {
    this.results.length = 0
  }
}

// =============================================================================
// DRY RUN BUILDER
// =============================================================================

/**
 * Builder for creating dry-run results.
 */
export class DryRunBuilder<S extends AnySchema> {
  constructor(
    private readonly schema: S,
    private readonly idGenerator: IdGenerator,
  ) {}

  createNode<N extends NodeLabels<S>>(
    label: N,
    data: NodeInput<S, N>,
    query: string,
    options?: CreateOptions,
  ): DryRunResult<NodeResult<S, N>> {
    const id = options?.id ?? this.idGenerator.generate(label as string)

    return {
      query,
      params: { id, props: data },
      simulatedResult: {
        id,
        data: { id, ...data } as NodeProps<S, N>,
      },
    }
  }

  updateNode<N extends NodeLabels<S>>(
    label: N,
    id: string,
    data: Partial<NodeInput<S, N>>,
    query: string,
  ): DryRunResult<NodeResult<S, N>> {
    return {
      query,
      params: { id, props: data },
      simulatedResult: {
        id,
        data: { id, ...data } as NodeProps<S, N>,
      },
    }
  }

  deleteNode(label: string, id: string, query: string): DryRunResult<DeleteResult> {
    return {
      query,
      params: { id },
      simulatedResult: { deleted: true, id },
    }
  }

  createEdge<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
    data: EdgeInput<S, E> | undefined,
    query: string,
  ): DryRunResult<EdgeResult<S, E>> {
    const edgeId = this.idGenerator.generate(edge as string)

    return {
      query,
      params: { fromId: from, toId: to, edgeId, props: data ?? {} },
      simulatedResult: {
        id: edgeId,
        from,
        to,
        data: { id: edgeId, ...data } as EdgeProps<S, E>,
      },
    }
  }

  deleteEdge(edge: string, from: string, to: string, query: string): DryRunResult<DeleteResult> {
    return {
      query,
      params: { fromId: from, toId: to },
      simulatedResult: { deleted: true, id: `${from}->${to}` },
    }
  }

  createChild<N extends NodeLabels<S>>(
    label: N,
    parentId: string,
    data: NodeInput<S, N>,
    query: string,
    _options?: HierarchyOptions<S>,
  ): DryRunResult<NodeResult<S, N>> {
    const id = this.idGenerator.generate(label as string)

    return {
      query,
      params: { id, parentId, props: data },
      simulatedResult: {
        id,
        data: { id, ...data } as NodeProps<S, N>,
      },
    }
  }

  move(
    nodeId: string,
    newParentId: string,
    query: string,
  ): DryRunResult<{ moved: boolean; nodeId: string; newParentId: string }> {
    return {
      query,
      params: { nodeId, newParentId },
      simulatedResult: {
        moved: true,
        nodeId,
        newParentId,
      },
    }
  }
}

// =============================================================================
// DRY RUN OPTIONS
// =============================================================================

export interface DryRunOptions {
  /** Collect results in a collector */
  collector?: DryRunCollector
  /** Include simulated results */
  includeSimulated?: boolean
  /** Validate data before generating query */
  validate?: boolean
}
