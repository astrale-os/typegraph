import type { GraphModel, IRAttribute, TypeRef, ValueConstraints, ValueNode } from '../model'
import { scalarToZod } from './scalars'
import { pascalCase } from './utils'

/**
 * Emit a single `validators` object with Zod schemas for every
 * type alias, concrete node (flattened), and edge payload.
 */
export function emitValidators(model: GraphModel): string {
  const lines: string[] = []
  lines.push('export const validators = {')

  // Type alias validators (enums + constrained scalars)
  for (const [, alias] of model.aliases) {
    if (alias.isEnum && alias.enumValues) {
      lines.push(`  ${alias.name}: z.enum(${alias.name}Values),`)
    } else {
      const base = scalarToZod(alias.underlyingType)
      lines.push(`  ${alias.name}: ${applyConstraints(base, alias.constraints)},`)
    }
  }
  lines.push('')

  // Concrete node validators (flattened with inherited attributes)
  for (const [, node] of model.nodeDefs) {
    if (node.abstract) continue
    lines.push(`  ${node.name}: z.object({`)
    for (const attr of node.allAttributes) {
      lines.push(`    ${attr.name}: ${resolveZodAttr(model, attr)},`)
    }
    lines.push('  }),')
  }
  lines.push('')

  // Edge payload validators
  for (const [, edge] of model.edgeDefs) {
    if (edge.allAttributes.length === 0) continue
    lines.push(`  ${pascalCase(edge.name)}: z.object({`)
    for (const attr of edge.allAttributes) {
      lines.push(`    ${attr.name}: ${resolveZodAttr(model, attr)},`)
    }
    lines.push('  }),')
  }

  lines.push('} as const')
  return lines.join('\n')
}

// ─── Attribute → Zod Chain ──────────────────────────────────

function resolveZodAttr(model: GraphModel, attr: IRAttribute): string {
  let chain = resolveZodTypeRef(model, attr.type)

  if (attr.value_constraints) {
    chain = applyConstraints(chain, attr.value_constraints)
  }
  if (attr.nullable) {
    chain = `${chain}.nullable().optional()`
  }
  if (attr.default) {
    const val = renderDefault(attr.default)
    if (val !== null) chain = `${chain}.default(${val})`
  }

  return chain
}

function resolveZodTypeRef(model: GraphModel, ref: TypeRef): string {
  switch (ref.kind) {
    case 'Scalar':
      return scalarToZod(ref.name)
    case 'Alias': {
      const alias = model.aliases.get(ref.name)
      if (!alias) return 'z.unknown()'
      if (alias.isEnum && alias.enumValues) return `z.enum(${alias.name}Values)`
      return applyConstraints(scalarToZod(alias.underlyingType), alias.constraints)
    }
    case 'Node':
      return 'z.string()' // ID ref
    case 'Edge':
      return 'z.string()'
    case 'AnyEdge':
      return 'z.string()'
    case 'Union':
      return `z.union([${ref.types.map((t) => resolveZodTypeRef(model, t)).join(', ')}])`
    default:
      return 'z.unknown()'
  }
}

// ─── Constraints ────────────────────────────────────────────

function applyConstraints(base: string, constraints: ValueConstraints | null): string {
  if (!constraints) return base
  let r = base

  if (constraints.format === 'email') r += '.email()'
  else if (constraints.format === 'url') r += '.url()'
  else if (constraints.format === 'uuid') r += '.uuid()'

  if (constraints.pattern) r += `.regex(/${constraints.pattern}/)`
  if (constraints.length_min !== undefined) r += `.min(${constraints.length_min})`
  if (constraints.length_max !== undefined) r += `.max(${constraints.length_max})`
  if (constraints.value_min !== undefined) r += `.min(${constraints.value_min})`
  if (constraints.value_max !== undefined) r += `.max(${constraints.value_max})`

  return r
}

// ─── Default Values ─────────────────────────────────────────

function renderDefault(value: ValueNode): string | null {
  switch (value.kind) {
    case 'StringLiteral':
      return `'${value.value}'`
    case 'NumberLiteral':
      return `${value.value}`
    case 'BooleanLiteral':
      return `${value.value}`
    case 'Null':
      return 'null'
    case 'Call':
      return null // function calls can't be static Zod defaults
  }
}
