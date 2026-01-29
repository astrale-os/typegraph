export type {
  AccessDecision,
  AccessExplanation,
  Grant,
  IdentityExpr,
  IdentityId,
  LeafEvaluation,
  NodeId,
  PermissionT,
  PhaseExplanation,
  Scope,
  FilterDetail,
} from '@authz/types'

export type MethodTiming = {
  method: string
  phase: 'trust' | 'decode' | 'resolve' | 'decide' | 'query'
  startMs: number // Wall clock start time (performance.now)
  endMs: number // Wall clock end time
  durationMs: number
  cached?: boolean
  query?: {
    // Cypher query details (for execute* methods)
    cypher: string
    params: Record<string, unknown>
  }
  metadata?: Record<string, unknown> // Additional context
}

export type PerformanceProfile = {
  totalMs: number
  resolveGrantMs: number
  authCheckMs: number
  calls: MethodTiming[]
}
