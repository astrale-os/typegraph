import type { GraphModel } from '../model'
import { pascalCase, section } from './utils'

/**
 * Emit TypeMap interface and typed createGraph wrapper.
 *
 * Produces:
 *  1. Node input types (*Input) — writable attributes (excludes readonly/computed)
 *  2. TypeMap interface — maps node/edge names to concrete TS types
 *  3. Typed createGraph() wrapper
 *
 * Depends on: interfaces emitter (node interfaces, edge payloads),
 *             methods emitter (enriched *Node types).
 */
export function emitTypemap(model: GraphModel): string {
  const concretes = [...model.nodeDefs.values()].filter((n) => !n.abstract && !n.origin)
  const allEdges = [...model.edgeDefs.values()]

  if (concretes.length === 0) return ''

  const lines: string[] = []

  lines.push(section('Node Input Types'))
  lines.push('')
  lines.push(emitNodeInputTypes(model, concretes))

  lines.push(section('TypeMap'))
  lines.push('')
  lines.push(emitTypeMapInterface(model, concretes, allEdges))

  lines.push(section('Typed Graph Factory'))
  lines.push('')
  lines.push(emitCreateGraphWrapper())

  return lines.join('\n')
}

// ─── Node Input Types ─────────────────────────────────────────

function emitNodeInputTypes(
  _model: GraphModel,
  concretes: { name: string; allAttributes: { name: string; readonly?: boolean }[] }[],
): string {
  const lines: string[] = []

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
  return lines.join('\n')
}

/**
 * Heuristic for readonly/computed fields.
 * These are excluded from mutation input types.
 */
function isReadonlyAttribute(name: string): boolean {
  return name === 'created_at' || name === 'updated_at'
}

// ─── TypeMap Interface ────────────────────────────────────────

function emitTypeMapInterface(
  _model: GraphModel,
  concretes: { name: string }[],
  allEdges: { name: string; ownAttributes: unknown[] }[],
): string {
  const lines: string[] = []

  lines.push("import type { TypeMap } from '@astrale/typegraph'")
  lines.push('')
  lines.push('export interface GeneratedTypeMap extends TypeMap {')

  // nodes
  lines.push('  nodes: {')
  for (const node of concretes) {
    lines.push(`    ${node.name}: ${node.name}Node`)
  }
  lines.push('  }')

  // edges
  lines.push('  edges: {')
  for (const edge of allEdges) {
    const payloadType =
      edge.ownAttributes.length > 0 ? `${pascalCase(edge.name)}Payload` : 'Record<string, never>'
    lines.push(`    ${edge.name}: ${payloadType}`)
  }
  lines.push('  }')

  // nodeInputs
  lines.push('  nodeInputs: {')
  for (const node of concretes) {
    lines.push(`    ${node.name}: ${node.name}Input`)
  }
  lines.push('  }')

  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

// ─── Typed createGraph Wrapper ────────────────────────────────

function emitCreateGraphWrapper(): string {
  const lines: string[] = []

  lines.push("import { createGraph as _createGraph, type GraphOptions } from '@astrale/typegraph'")
  lines.push('')
  lines.push("export function createTypedGraph(options: Omit<GraphOptions, 'schema'>) {")
  lines.push('  return _createGraph<typeof schema, GeneratedTypeMap>(schema, {')
  lines.push('    ...options,')
  lines.push('    validation: { validators, ...options.validation },')
  lines.push('  })')
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}
