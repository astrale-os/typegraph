import type { GraphModel } from '../model'
import { pascalCase } from './utils'

/**
 * Emit the Core DSL: typed helpers for declaring foundational
 * instances (`defineCore`, `node`, `edge`) and the `Refs` type
 * that maps schema types + core keys to runtime IDs.
 *
 * Depends on: SchemaNodeType, SchemaEdgeType, SchemaType (from schema-types),
 * node interfaces (from interfaces), edge payloads (from interfaces).
 */
export function emitCore(model: GraphModel): string {
  const lines: string[] = []

  const concreteNodes = [...model.nodeDefs.values()].filter((n) => !n.abstract && !n.origin)
  const edges = [...model.edgeDefs.values()].filter((e) => !e.origin)
  const edgesWithPayload = edges.filter((e) => e.allAttributes.length > 0)

  if (concreteNodes.length === 0 && edges.length === 0) return ''

  // ── CoreNodeProps ────────────────────────────────────────
  lines.push('export interface CoreNodeProps {')
  for (const node of concreteNodes) {
    lines.push(`  ${node.name}: Partial<${node.name}>`)
  }
  lines.push('}')
  lines.push('')

  // ── CoreEdgeEndpoints ────────────────────────────────────
  lines.push('export interface CoreEdgeEndpoints {')
  for (const edge of edges) {
    const params = edge.endpoints.map((ep) => `${ep.param_name}: string`).join('; ')
    lines.push(`  ${edge.name}: { ${params} }`)
  }
  lines.push('}')
  lines.push('')

  // ── CoreEdgeProps (only edges with attributes) ───────────
  if (edgesWithPayload.length > 0) {
    lines.push('export interface CoreEdgeProps {')
    for (const edge of edgesWithPayload) {
      lines.push(`  ${edge.name}: Partial<${pascalCase(edge.name)}Payload>`)
    }
    lines.push('}')
    lines.push('')
  }

  // ── Structural types ─────────────────────────────────────
  lines.push('export interface CoreNodeDef<T extends SchemaNodeType = SchemaNodeType> {')
  lines.push('  readonly __type: T')
  lines.push('  readonly props: CoreNodeProps[T]')
  lines.push('  readonly children?: Record<string, CoreNodeDef>')
  lines.push('}')
  lines.push('')

  lines.push('export interface CoreEdgeDef<T extends SchemaEdgeType = SchemaEdgeType> {')
  lines.push('  readonly __type: T')
  lines.push('  readonly endpoints: CoreEdgeEndpoints[T]')
  if (edgesWithPayload.length > 0) {
    lines.push('  readonly props?: T extends keyof CoreEdgeProps ? CoreEdgeProps[T] : never')
  }
  lines.push('}')
  lines.push('')

  lines.push('export interface CoreDefinition {')
  lines.push('  nodes: Record<string, CoreNodeDef>')
  lines.push('  edges?: CoreEdgeDef[]')
  lines.push('}')
  lines.push('')

  // ── node() — overloaded to preserve children literal types
  emitNodeHelper(lines)

  // ── edge() ───────────────────────────────────────────────
  emitEdgeHelper(lines, edgesWithPayload.length > 0)

  // ── defineCore() ─────────────────────────────────────────
  lines.push('export function defineCore<const T extends CoreDefinition>(def: T): T {')
  lines.push('  return def')
  lines.push('}')
  lines.push('')

  // ── Refs type ────────────────────────────────────────────
  emitRefsType(lines)
  emitNestedCoreRefsType(lines)

  return lines.join('\n')
}

// ─── Helper Emitters ────────────────────────────────────────

function emitNodeHelper(lines: string[]): void {
  // Overload 1: without children
  lines.push('export function node<T extends SchemaNodeType>(')
  lines.push('  type: T,')
  lines.push('  props: CoreNodeProps[T],')
  lines.push('): CoreNodeDef<T>')

  // Overload 2: children as direct 3rd argument
  lines.push(
    'export function node<T extends SchemaNodeType, C extends Record<string, CoreNodeDef>>(',
  )
  lines.push('  type: T,')
  lines.push('  props: CoreNodeProps[T],')
  lines.push('  children: C,')
  lines.push('): CoreNodeDef<T> & { readonly children: C }')

  // Implementation
  lines.push('export function node(')
  lines.push('  type: string,')
  lines.push('  props: Record<string, unknown>,')
  lines.push('  children?: Record<string, CoreNodeDef>,')
  lines.push('): CoreNodeDef {')
  lines.push(
    '  return { __type: type as SchemaNodeType, props, ...(children ? { children } : {}) }',
  )
  lines.push('}')
  lines.push('')
}

function emitEdgeHelper(lines: string[], hasPayloads: boolean): void {
  if (hasPayloads) {
    lines.push('export function edge<T extends SchemaEdgeType>(')
    lines.push('  type: T,')
    lines.push('  endpoints: CoreEdgeEndpoints[T],')
    lines.push('  props?: T extends keyof CoreEdgeProps ? CoreEdgeProps[T] : never,')
    lines.push('): CoreEdgeDef<T> {')
    lines.push(
      '  return { __type: type, endpoints, ...(props ? { props } : {}) } as CoreEdgeDef<T>',
    )
    lines.push('}')
  } else {
    lines.push('export function edge<T extends SchemaEdgeType>(')
    lines.push('  type: T,')
    lines.push('  endpoints: CoreEdgeEndpoints[T],')
    lines.push('): CoreEdgeDef<T> {')
    lines.push('  return { __type: type, endpoints }')
    lines.push('}')
  }
  lines.push('')
}

function emitRefsType(lines: string[]): void {
  lines.push('type FlattenCoreKeys<T extends Record<string, any>> =')
  lines.push(
    '  { [K in keyof T & string]: K | (T[K] extends { readonly children: infer C extends Record<string, any> } ? FlattenCoreKeys<C> : never) }[keyof T & string]',
  )
  lines.push('')
  lines.push("export type ExtractCoreKeys<T extends CoreDefinition> = FlattenCoreKeys<T['nodes']>")
  lines.push('')
  lines.push('export type Refs<T extends CoreDefinition = CoreDefinition> =')
  lines.push('  Record<SchemaType | Extract<ExtractCoreKeys<T>, string>, NodeId>')
  lines.push('')
}

function emitNestedCoreRefsType(lines: string[]): void {
  lines.push('/** Nested core refs type - supports hierarchical access like core.electronics.phones */')
  lines.push('type NestedCoreKeys<T extends Record<string, any>> = {')
  lines.push('  [K in keyof T & string]: T[K] extends { readonly children: infer C extends Record<string, any> }')
  lines.push('    ? NestedCoreKeys<C> & NodeId  // Parent with children')
  lines.push('    : NodeId                       // Leaf node ID')
  lines.push('}')
  lines.push('')
  lines.push('export type CoreRefs<T extends CoreDefinition = CoreDefinition> =')
  lines.push("  NestedCoreKeys<T['nodes']> & Record<SchemaType, NodeId>")
  lines.push('')
}
