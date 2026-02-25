import type { GraphModel } from '../model'
import { pascalCase } from './utils'

/**
 * Emit TypeMap interface, node input types, and typed createGraph wrapper.
 *
 * Depends on: interfaces emitter (node interfaces, edge payloads),
 *             methods emitter (enriched *Node types).
 */
export function emitTypemap(model: GraphModel): string {
  const concretes = [...model.nodeDefs.values()].filter((n) => !n.abstract)
  const allEdges = [...model.edgeDefs.values()]

  if (concretes.length === 0) return ''

  const lines: string[] = []

  // Node input types (writable attributes, excluding readonly/computed)
  for (const node of concretes) {
    const readonlyFields = node.allAttributes
      .filter((a) => isReadonlyAttribute(a.name))
      .map((a) => `'${a.name}'`)

    if (readonlyFields.length > 0) {
      lines.push(
        `export type ${node.name}Input = Omit<${node.name}, ${readonlyFields.join(' | ')}>`,
      )
    } else {
      lines.push(`export type ${node.name}Input = ${node.name}`)
    }
  }
  lines.push('')

  // TypeMap interface
  lines.push("import type { TypeMap, Graph } from '@astrale/typegraph-client'")
  lines.push('')
  lines.push('export interface GeneratedTypeMap extends TypeMap {')
  lines.push('  nodes: {')
  for (const node of concretes) {
    lines.push(`    ${node.name}: ${node.name}Node`)
  }
  lines.push('  }')
  lines.push('  edges: {')
  for (const edge of allEdges) {
    const payloadType =
      edge.ownAttributes.length > 0 ? `${pascalCase(edge.name)}Payload` : 'Record<string, never>'
    lines.push(`    ${edge.name}: ${payloadType}`)
  }
  lines.push('  }')
  lines.push('  nodeInputs: {')
  for (const node of concretes) {
    lines.push(`    ${node.name}: ${node.name}Input`)
  }
  lines.push('  }')

  // nodeData mapping: node type → data type (only for nodes with data)
  const nodesWithData = concretes.filter((n) => n.dataRef)
  if (nodesWithData.length > 0) {
    lines.push('  nodeData: {')
    for (const node of nodesWithData) {
      lines.push(`    ${node.name}: ${node.dataRef}`)
    }
    lines.push('  }')
  }

  lines.push('}')
  lines.push('')

  // GraphTypes interface (for GraphPort<T> usage — no typegraph-client dependency)
  lines.push("import type { GraphTypes } from '@astrale-os/kernel-ports'")
  lines.push('')
  lines.push('export interface GeneratedGraphTypes extends GraphTypes {')
  lines.push('  nodes: {')
  for (const node of concretes) {
    lines.push(`    ${node.name}: ${node.name}Node`)
  }
  lines.push('  }')
  lines.push('  links: {')
  for (const edge of allEdges) {
    const payloadType =
      edge.ownAttributes.length > 0 ? `${pascalCase(edge.name)}Payload` : 'Record<string, never>'
    lines.push(`    ${edge.name}: ${payloadType}`)
  }
  lines.push('  }')
  lines.push('  nodeInputs: {')
  for (const node of concretes) {
    lines.push(`    ${node.name}: ${node.name}Input`)
  }
  lines.push('  }')
  lines.push('}')
  lines.push('')

  // Typed createGraph wrapper
  lines.push("import { createGraph as _createGraph, type GraphOptions } from '@astrale/typegraph-client'")
  lines.push('')
  lines.push("export function createTypedGraph(options: Omit<GraphOptions, 'schema'>) {")
  lines.push('  return _createGraph<typeof schema, GeneratedTypeMap>(schema, {')
  lines.push('    ...options,')
  lines.push('    validation: { validators, ...options.validation },')
  lines.push('  })')
  lines.push('}')
  lines.push('')

  // Pre-bound Graph type alias
  lines.push('export type SchemaGraph = Graph<typeof schema, GeneratedTypeMap>')
  lines.push('')

  return lines.join('\n')
}

/**
 * Heuristic for readonly/computed fields.
 * These are excluded from mutation input types.
 */
function isReadonlyAttribute(name: string): boolean {
  return name === 'created_at' || name === 'updated_at'
}
