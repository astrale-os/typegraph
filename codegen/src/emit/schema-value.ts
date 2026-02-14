import type { GraphModel, TypeRef, EdgeConstraints, MethodDef, MethodParam, ValueNode } from '../model'

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

  // Methods metadata
  const typesWithMethods = [
    ...[...model.nodeDefs.values()].filter((n) => n.ownMethods.length > 0),
    ...[...model.edgeDefs.values()].filter((e) => e.ownMethods.length > 0),
  ]
  if (typesWithMethods.length > 0) {
    lines.push('')
    lines.push('  methods: {')
    for (const def of typesWithMethods) {
      lines.push(`    ${def.name}: {`)
      for (const m of def.ownMethods) {
        const params = emitMethodParams(m.params)
        const returns = emitReturnTypeStr(m)
        lines.push(`      ${m.name}: { params: ${params}, returns: '${returns}' },`)
      }
      lines.push('    },')
    }
    lines.push('  },')
  }

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

function emitMethodParams(params: MethodParam[]): string {
  if (params.length === 0) return '{}'
  const entries = params.map((p) => {
    const typeStr = typeRefToStr(p.type)
    if (p.default !== null) {
      const defaultVal = valueNodeToLiteral(p.default)
      return `${p.name}: { type: '${typeStr}', default: ${defaultVal} }`
    }
    return `${p.name}: { type: '${typeStr}' }`
  })
  return `{ ${entries.join(', ')} }`
}

function emitReturnTypeStr(m: MethodDef): string {
  const base = typeRefToStr(m.return_type)
  if (m.return_type.kind === 'List') return `${base}[]`
  if (m.return_nullable) return `${base}?`
  return base
}

function typeRefToStr(ref: TypeRef): string {
  switch (ref.kind) {
    case 'Scalar':
    case 'Node':
    case 'Alias':
    case 'Edge':
      return ref.name
    case 'List':
      return typeRefToStr(ref.element)
    default:
      return ref.kind
  }
}

function valueNodeToLiteral(v: ValueNode | null): string {
  if (v === null) return 'null'
  switch (v.kind) {
    case 'NumberLiteral': return String(v.value)
    case 'StringLiteral': return `'${v.value}'`
    case 'BooleanLiteral': return String(v.value)
    case 'Null': return 'null'
    case 'Call': return `${v.fn}()`
  }
}
