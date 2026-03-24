import type { GraphModel, IRAttribute } from '../model'

import { scalarToZod } from './scalars'
import { pascalCase } from './utils'
import { resolveZodTypeRef, applyConstraints, renderDefault } from './zod-utils'

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

  // Value type validators
  if (model.valueTypes.size > 0) {
    for (const [, vt] of model.valueTypes) {
      lines.push(`  ${vt.name}: z.object({`)
      for (const field of vt.fields) {
        let chain = resolveZodTypeRef(model, field.type)
        if (field.nullable) {
          chain = `${chain}.nullable().optional()`
        }
        if (field.default) {
          const val = renderDefault(field.default)
          if (val !== null) chain = `${chain}.default(${val})`
        }
        lines.push(`    ${field.name}: ${chain},`)
      }
      lines.push('  }),')
    }
    lines.push('')
  }

  // Tagged union validators
  if (model.taggedUnions.size > 0) {
    for (const [, tu] of model.taggedUnions) {
      const variantSchemas = tu.variants.map((v) => {
        const fieldLines: string[] = []
        fieldLines.push(`      kind: z.literal('${v.tag}'),`)
        for (const field of v.fields) {
          let chain = resolveZodTypeRef(model, field.type)
          if (field.nullable) {
            chain = `${chain}.nullable().optional()`
          }
          if (field.default) {
            const val = renderDefault(field.default)
            if (val !== null) chain = `${chain}.default(${val})`
          }
          fieldLines.push(`      ${field.name}: ${chain},`)
        }
        return `    z.object({\n${fieldLines.join('\n')}\n    })`
      })
      lines.push(`  ${tu.name}: z.discriminatedUnion('kind', [`)
      lines.push(variantSchemas.join(',\n') + ',')
      lines.push('  ]),')
    }
    lines.push('')
  }

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
