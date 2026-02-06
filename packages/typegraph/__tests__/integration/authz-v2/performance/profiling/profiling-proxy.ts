/**
 * Profiling Access Query Adapter
 *
 * Wraps AccessQueryPort to instrument every operation with microsecond precision.
 * Uses SpanCollector to record timing and metadata without modifying core code.
 */

import type { AccessQueryPort } from '../../authorization/access-query-port'
import type { CypherFragment } from '../../adapter/cypher'
import type { PrunedIdentityExpr, NodeId, Permission, LeafEvaluation } from '../../types'
import type { Phase, SpanMetadata } from './types'
import { type SpanCollector } from './span-collector'

// =============================================================================
// PROFILING PROXY
// =============================================================================

/**
 * Proxy adapter that instruments all AccessQueryPort operations.
 *
 * Records timing spans for:
 * - generateQuery: Cypher query generation
 * - executeResourceCheck: Resource permission check
 * - executeTypeCheck: Type permission check
 * - getTargetType: Type lookup
 * - queryLeafDetails: Leaf detail resolution
 * - clearCache: Cache clearing
 */
export class ProfilingAccessQueryAdapter implements AccessQueryPort {
  constructor(
    private inner: AccessQueryPort,
    private collector: SpanCollector,
  ) {}

  /**
   * Instrument an async method call.
   */
  private async instrumentAsync<T>(
    name: string,
    phase: Phase,
    fn: () => Promise<T>,
    metadata?: Partial<SpanMetadata>,
  ): Promise<T> {
    return this.collector.recordAsync(name, phase, fn, metadata)
  }

  /**
   * Instrument a sync method call.
   */
  private instrumentSync<T>(
    name: string,
    phase: Phase,
    fn: () => T,
    metadata?: Partial<SpanMetadata>,
  ): T {
    return this.collector.recordSync(name, phase, fn, metadata)
  }

  // ===========================================================================
  // AccessQueryPort Implementation
  // ===========================================================================

  generateQuery(
    expr: PrunedIdentityExpr,
    perm: Permission,
  ): CypherFragment | null {
    return this.instrumentSync(
      'generateQuery',
      'resolve',
      () => this.inner.generateQuery(expr, perm),
      {
        inputSize: JSON.stringify(expr).length,
      },
    )
  }

  async executeResourceCheck(fragment: CypherFragment, resourceId: NodeId): Promise<boolean> {
    return this.instrumentAsync(
      'executeResourceCheck',
      'query',
      async () => this.inner.executeResourceCheck(fragment, resourceId),
      {
        query: {
          cypher: fragment.condition,
          params: fragment.params,
        },
      },
    )
  }

  async executeTypeCheck(fragment: CypherFragment, typeId: NodeId): Promise<boolean> {
    return this.instrumentAsync(
      'executeTypeCheck',
      'query',
      async () => this.inner.executeTypeCheck(fragment, typeId),
      {
        query: {
          cypher: fragment.condition,
          params: fragment.params,
        },
      },
    )
  }

  async getTargetType(resourceId: NodeId): Promise<NodeId | null> {
    return this.instrumentAsync('getTargetType', 'query', async () =>
      this.inner.getTargetType(resourceId),
    )
  }

  async queryLeafDetails(
    leaves: LeafEvaluation[],
    resourceId: NodeId,
    perm: Permission,
  ): Promise<void> {
    return this.instrumentAsync(
      'queryLeafDetails',
      'query',
      async () => this.inner.queryLeafDetails(leaves, resourceId, perm),
      {
        inputSize: leaves.length,
      },
    )
  }

  clearCache(): void {
    this.instrumentSync('clearCache', 'decide', () => this.inner.clearCache())
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a profiling proxy around an existing AccessQueryPort.
 */
export function createProfilingAdapter(
  inner: AccessQueryPort,
  collector: SpanCollector,
): ProfilingAccessQueryAdapter {
  return new ProfilingAccessQueryAdapter(inner, collector)
}
