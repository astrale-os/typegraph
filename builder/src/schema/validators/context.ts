import type { IfaceDef } from '../../defs/iface.js'
import type { NodeDef } from '../../defs/node.js'
import type { EdgeDef } from '../../defs/edge.js'

export interface SchemaContext {
  readonly domain: string
  readonly defs: Record<string, any>
  readonly ifaces: Record<string, IfaceDef>
  readonly nodes: Record<string, NodeDef>
  readonly edges: Record<string, EdgeDef>
  readonly allDefValues: Set<object>
}
