import type { GraphModel } from '../model'

/**
 * Emit union type aliases for concrete node types, edge types,
 * and the combined SchemaType. These are consumed by the Core DSL
 * and the TypeGraph Client/SDK.
 */
export function emitSchemaTypes(model: GraphModel): string {
  const lines: string[] = []

  const concreteNodes = [...model.nodeDefs.values()]
    .filter((n) => !n.abstract)
    .map((n) => n.name)

  const edges = [...model.edgeDefs.values()].map((e) => e.name)

  if (concreteNodes.length > 0) {
    lines.push(`export type SchemaNodeType = ${concreteNodes.map((n) => `'${n}'`).join(' | ')}`)
  }

  if (edges.length > 0) {
    lines.push(`export type SchemaEdgeType = ${edges.map((e) => `'${e}'`).join(' | ')}`)
  }

  const parts: string[] = []
  if (concreteNodes.length > 0) parts.push('SchemaNodeType')
  if (edges.length > 0) parts.push('SchemaEdgeType')
  if (parts.length > 0) {
    lines.push(`export type SchemaType = ${parts.join(' | ')}`)
  }

  return lines.join('\n')
}
