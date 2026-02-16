/**
 * Method System
 *
 * Validates that all required method implementations are provided at startup,
 * and provides runtime method invocation for nodes and edges.
 */

import { MethodNotImplementedError } from './errors'

// ─── Types ───────────────────────────────────────────────────

/** Runtime method handler. Receives self + args + graph, returns a value. */
export type MethodHandler = (ctx: MethodCallContext) => unknown

export interface MethodCallContext {
  /** The node/edge instance (props + id + __type). */
  self: Record<string, unknown> & { readonly id: string }
  /** Method arguments, or undefined if paramless. */
  args: unknown
  /** The graph client (for graph operations inside methods). */
  graph: unknown
}

/**
 * Map of type → method → handler.
 * Keys are type names (e.g., 'Customer', 'order_item').
 */
export type MethodsConfig = Record<string, Record<string, MethodHandler>>

/**
 * Runtime schema metadata shape used for method validation.
 * Compatible with the `schema` const emitted by codegen.
 */
export interface MethodSchemaInfo {
  readonly nodes: Record<string, { abstract?: boolean; implements?: readonly string[] }>
  readonly edges: Record<string, unknown>
  readonly methods?: Record<string, Record<string, unknown>>
}

// ─── Startup Validation ──────────────────────────────────────

/**
 * Validate that all required method implementations are provided.
 * Called at createGraph() time — fails fast on missing handlers.
 */
export function validateMethodImplementations(
  schemaInfo: MethodSchemaInfo,
  methods: MethodsConfig | undefined,
): void {
  const missing: string[] = []

  // Node methods (own + inherited from interfaces)
  for (const [typeName, typeDef] of Object.entries(schemaInfo.nodes)) {
    if (typeDef.abstract) continue
    const required = collectRequiredMethods(schemaInfo, typeName)
    for (const [methodName, source] of required) {
      if (!methods?.[typeName]?.[methodName]) {
        missing.push(
          source === typeName
            ? `${typeName}.${methodName}()`
            : `${typeName}.${methodName}() (inherited from ${source})`,
        )
      }
    }
  }

  // Edge methods
  for (const edgeName of Object.keys(schemaInfo.edges)) {
    const edgeMethods = Object.keys(schemaInfo.methods?.[edgeName] ?? {})
    for (const methodName of edgeMethods) {
      if (!methods?.[edgeName]?.[methodName]) {
        missing.push(`${edgeName}.${methodName}()`)
      }
    }
  }

  if (missing.length > 0) {
    throw new MethodNotImplementedError(missing)
  }
}

/**
 * Collect all required methods for a concrete type,
 * walking the inheritance chain.
 * Returns Map<methodName, sourceTypeName>.
 */
export function collectRequiredMethods(
  schemaInfo: MethodSchemaInfo,
  typeName: string,
): Map<string, string> {
  const result = new Map<string, string>()

  // Own methods
  for (const name of Object.keys(schemaInfo.methods?.[typeName] ?? {})) {
    result.set(name, typeName)
  }

  // Walk implements chain
  const impl = schemaInfo.nodes[typeName]?.implements ?? []
  for (const iface of impl) {
    for (const name of Object.keys(schemaInfo.methods?.[iface] ?? {})) {
      if (!result.has(name)) result.set(name, iface)
    }
    const inherited = collectRequiredMethods(schemaInfo, iface)
    for (const [name, source] of inherited) {
      if (!result.has(name)) result.set(name, source)
    }
  }

  return result
}

// ─── Runtime Invocation ──────────────────────────────────────

/**
 * Invoke a method on a node instance.
 * Fetches the node, then calls the handler with the proper context.
 */
export async function callNodeMethod(
  fetchNode: () => Promise<{ id: string; props: Record<string, unknown> } | null>,
  type: string,
  method: string,
  args: unknown,
  methods: MethodsConfig,
  graph: unknown,
): Promise<unknown> {
  const handler = methods?.[type]?.[method]
  if (!handler) throw new MethodNotImplementedError([`${type}.${method}()`])

  const raw = await fetchNode()
  if (!raw) throw new Error(`${type} not found`)

  return handler({
    self: { ...raw.props, id: raw.id, __type: type } as MethodCallContext['self'],
    args: args ?? undefined,
    graph,
  })
}

/**
 * Invoke a method on an edge instance.
 */
export async function callEdgeMethod(
  fetchEdge: () => Promise<{
    props: Record<string, unknown>
    endpoints: Record<string, string>
  } | null>,
  edgeType: string,
  method: string,
  args: unknown,
  methods: MethodsConfig,
  graph: unknown,
): Promise<unknown> {
  const handler = methods?.[edgeType]?.[method]
  if (!handler) throw new MethodNotImplementedError([`${edgeType}.${method}()`])

  const raw = await fetchEdge()
  if (!raw) throw new Error(`${edgeType} edge not found`)

  return handler({
    self: {
      ...raw.props,
      id: Object.values(raw.endpoints).join(':'),
      ...raw.endpoints,
    } as MethodCallContext['self'],
    args: args ?? undefined,
    graph,
  })
}
