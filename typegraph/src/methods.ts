/**
 * Method Dispatch
 *
 * Methods are operations bound to a node/edge. The SDK dispatches them
 * through the kernel via the `dispatch` function provided at graph creation.
 *
 * This module defines the dispatch types. The actual execution goes through
 * the kernel's operation pipeline (auth, policies, events, etc.).
 */

// ─── Dispatch Types ──────────────────────────────────────────

/**
 * Operation dispatcher for method calls.
 * Signature matches kernel.call — the graph stores this directly.
 *
 * @param name  - Operation name (e.g., 'Customer.displayName')
 * @param auth  - Auth context (opaque to the SDK)
 * @param params - Method arguments (flat, not wrapped)
 * @param self  - Bound node/edge instance
 */
export interface OperationSelf {
  readonly id: string
  [key: string]: unknown
}

export type MethodDispatchFn = (
  name: string,
  auth: unknown,
  params: unknown,
  self: OperationSelf,
) => Promise<unknown>

/**
 * Runtime schema metadata shape used for method resolution.
 * Compatible with the `schema` const emitted by codegen.
 */
export interface MethodSchemaInfo {
  readonly nodes: Record<string, { abstract?: boolean; implements?: readonly string[] }>
  readonly edges: Record<string, unknown>
  readonly methods?: Record<string, Record<string, unknown>>
}

// ─── Method Name Resolution ──────────────────────────────────

/**
 * Collect all method names for a concrete type, walking the inheritance chain.
 * Used by enrichment to know which property names should be proxied.
 */
export function collectMethodNames(schemaInfo: MethodSchemaInfo, typeName: string): string[] {
  const names = new Set<string>()

  // Own methods
  for (const name of Object.keys(schemaInfo.methods?.[typeName] ?? {})) {
    names.add(name)
  }

  // Walk implements chain
  const impl = schemaInfo.nodes[typeName]?.implements ?? []
  for (const iface of impl) {
    for (const name of collectMethodNames(schemaInfo, iface)) {
      names.add(name)
    }
  }

  return [...names]
}
