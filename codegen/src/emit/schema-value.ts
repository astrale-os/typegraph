import type { GraphModel, TypeRef, EdgeConstraints } from '../model'

/**
 * Emit a `schema` const that captures graph topology at runtime:
 * node metadata (abstract, implements, attribute names) and
 * edge metadata (endpoints, constraints, attribute names).
 *
 * The TypeGraph Client/SDK consumes this for query/mutation building.
 */
export function emitSchemaValue(model: GraphModel): string {
  const lines: string[] = []
  lines.push('export const schema = {')

  // Scalars
  lines.push(`  scalars: [${model.scalars.map((s) => `'${s}'`).join(', ')}],`)
  lines.push('')

  // Nodes
  lines.push('  nodes: {')
  for (const [, node] of model.nodeDefs) {
    lines.push(`    ${node.name}: {`)
    lines.push(`      abstract: ${node.abstract},`)
    if (node.implements.length > 0) {
      lines.push(`      implements: [${node.implements.map((i) => `'${i}'`).join(', ')}],`)
    }
    if (node.allAttributes.length > 0) {
      const names = node.allAttributes.map((a) => `'${a.name}'`).join(', ')
      lines.push(`      attributes: [${names}],`)
    }
    lines.push('    },')
  }
  lines.push('  },')
  lines.push('')

  // Edges
  lines.push('  edges: {')
  for (const [, edge] of model.edgeDefs) {
    lines.push(`    ${edge.name}: {`)

    // Endpoints
    lines.push('      endpoints: {')
    for (const ep of edge.endpoints) {
      const types = ep.allowed_types.map(endpointTypeStr).join(', ')
      const card = ep.cardinality ? cardinalityStr(ep.cardinality) : ''
      lines.push(`        ${ep.param_name}: { types: [${types}]${card} },`)
    }
    lines.push('      },')

    // Constraints (only emit non-false values)
    const cstr = constraintEntries(edge.constraints)
    if (cstr) {
      lines.push(`      constraints: { ${cstr} },`)
    }

    // Attributes
    if (edge.allAttributes.length > 0) {
      const names = edge.allAttributes.map((a) => `'${a.name}'`).join(', ')
      lines.push(`      attributes: [${names}],`)
    }

    lines.push('    },')
  }
  lines.push('  },')

  lines.push('} as const')
  return lines.join('\n')
}

// ─── Helpers ────────────────────────────────────────────────

function endpointTypeStr(ref: TypeRef): string {
  switch (ref.kind) {
    case 'Node':
      return `'${ref.name}'`
    case 'AnyEdge':
      return `'*'`
    default:
      return `'${(ref as { name?: string }).name ?? ref.kind}'`
  }
}

function cardinalityStr(c: { min: number; max: number | null }): string {
  const max = c.max === null ? 'null' : `${c.max}`
  return `, cardinality: { min: ${c.min}, max: ${max} }`
}

function constraintEntries(c: EdgeConstraints): string | null {
  const parts: string[] = []
  if (c.no_self) parts.push('no_self: true')
  if (c.acyclic) parts.push('acyclic: true')
  if (c.unique) parts.push('unique: true')
  if (c.symmetric) parts.push('symmetric: true')
  if (c.on_kill_source) parts.push(`on_kill_source: '${c.on_kill_source}'`)
  if (c.on_kill_target) parts.push(`on_kill_target: '${c.on_kill_target}'`)
  return parts.length > 0 ? parts.join(', ') : null
}
