import type { GraphModel } from '../model'
import { pascalCase } from './utils'

/**
 * Emit the schema-typed `defineMethods` factory and per-type typed wrappers.
 *
 * Produces:
 *  1. Base factory: `export const defineMethods = createMethodFactory<...>()`
 *  2. Per-type wrappers: `export const defineCustomerMethods = defineMethods.withSelf<CustomerNode>()`
 *
 * The per-type wrappers give every hook a fully typed `self` and `kernel.graph`.
 */
export function emitMethodFactory(model: GraphModel): string {
  const lines: string[] = []

  lines.push('export const defineMethods = createMethodFactory<GeneratedGraphTypes>()')
  lines.push('')

  // Nodes with methods → self = <Name>Node
  for (const [, node] of model.nodeDefs) {
    if (node.abstract) continue
    if (node.allMethods.length === 0) continue
    lines.push(
      `export const define${node.name}Methods = defineMethods.withSelf<${node.name}Node>()`,
    )
  }

  // Edges with methods → self = <Name>Payload & OperationSelf
  for (const [, edge] of model.edgeDefs) {
    if (edge.allMethods.length === 0) continue
    const name = pascalCase(edge.name)
    const hasPayload = edge.ownAttributes.length > 0
    const selfType = hasPayload ? `${name}Payload & OperationSelf` : 'OperationSelf'
    lines.push(`export const define${name}Methods = defineMethods.withSelf<${selfType}>()`)
  }

  lines.push('')
  return lines.join('\n')
}
