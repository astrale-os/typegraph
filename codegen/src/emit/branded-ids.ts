import type { GraphModel } from '../model'

/**
 * Emit branded ID types for type-safe graph IDs.
 *
 * Produces:
 *  1. NodeBrand phantom type + generic NodeId
 *  2. Per-node branded IDs (CustomerId, ProductId, etc.)
 *  3. Constructor functions for each (zero runtime cost casts)
 *
 * The brand shapes are structurally identical to the kernel's
 * ids.types.ts, so generated IDs are assignable to kernel NodeId.
 */
export function emitBrandedIds(model: GraphModel): string {
  const concreteNodes = [...model.nodeDefs.values()].filter((n) => !n.abstract && !n.origin)
  if (concreteNodes.length === 0) return ''

  const lines: string[] = []

  // Base brands
  lines.push('type NodeBrand = { readonly __nodeId: true }')
  lines.push('')
  lines.push('export type NodeId = string & NodeBrand')

  // Per-node branded types
  for (const node of concreteNodes) {
    lines.push(`export type ${node.name}Id = NodeId & { readonly __${lcFirst(node.name)}Id: true }`)
  }
  lines.push('')

  // Constructor functions (value-level counterparts)
  lines.push('export const NodeId = (id: string) => id as NodeId')
  for (const node of concreteNodes) {
    lines.push(`export const ${node.name}Id = (id: string) => id as ${node.name}Id`)
  }
  lines.push('')

  return lines.join('\n')
}

function lcFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}
