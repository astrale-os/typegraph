import type { GraphModel, MethodDef } from '../model'
import { pascalCase } from './utils'

/**
 * Emit a `methods.ts` scaffold with typed `define<Type>Methods(...)` blocks.
 *
 * Generated output:
 * ```
 * import { defineCustomerMethods, CustomerOps } from './schema.generated'
 *
 * export const CustomerMethods = defineCustomerMethods(CustomerOps, {
 *   displayName: {
 *     authorize: ({ self }) => ({ nodeIds: [self.id], perm: READ }),
 *     execute: async ({ self }) => { throw new Error('TODO: Customer.displayName') },
 *   },
 * })
 * ```
 */
export function emitMethodScaffold(model: GraphModel): string {
  const groups: { typeName: string; isEdge: boolean; methods: MethodDef[] }[] = []

  for (const [, node] of model.nodeDefs) {
    if (node.abstract || node.origin) continue
    if (node.allMethods.length > 0) {
      groups.push({ typeName: node.name, isEdge: false, methods: node.allMethods })
    }
  }
  for (const [, edge] of model.edgeDefs) {
    if (edge.allMethods.length > 0) {
      groups.push({ typeName: pascalCase(edge.name), isEdge: true, methods: edge.allMethods })
    }
  }

  if (groups.length === 0) return ''

  const lines: string[] = []

  // Imports: per-type define functions + ops constants
  const imports: string[] = []
  for (const g of groups) {
    imports.push(`define${g.typeName}Methods`)
    imports.push(`${g.typeName}Ops`)
  }
  lines.push(`import { ${imports.join(', ')} } from './schema.generated'`)
  lines.push('')

  // Method blocks
  for (const { typeName, methods } of groups) {
    const opsName = `${typeName}Ops`
    const varName = `${typeName}Methods`
    const defFn = `define${typeName}Methods`

    lines.push(`export const ${varName} = ${defFn}(${opsName}, {`)
    for (const m of methods) {
      const perm = m.access === 'private' ? 'write' : 'read'
      const hasParams = m.params.length > 0
      const paramsDestructure = hasParams ? ', params' : ''

      lines.push(`  ${m.name}: {`)
      lines.push(`    authorize: ({ self }) => ({ nodeIds: [self.id], perm: '${perm}' }),`)
      lines.push(
        `    execute: async ({ self${paramsDestructure} }) => { throw new Error('TODO: ${typeName}.${m.name}') },`,
      )
      lines.push('  },')
    }
    lines.push('})')
    lines.push('')
  }

  return lines.join('\n')
}
