import type { IfaceDef } from '../../defs/iface.js'
import type { NodeDef } from '../../defs/node.js'
import type { EdgeDef } from '../../defs/edge.js'
import type { OpDef } from '../../defs/op.js'
import { registerDef } from '../../registry.js'
import { SchemaValidationError } from '../schema.js'
import type { SchemaContext } from './context.js'

/** Resolve all thunks (config + param) and partition defs by type. */
export function categorize(domain: string, defs: Record<string, any>): SchemaContext {
  const ifaces: Record<string, IfaceDef> = {}
  const nodes: Record<string, NodeDef> = {}
  const edges: Record<string, EdgeDef> = {}

  for (const [name, def] of Object.entries(defs)) {
    if (def === null || typeof def !== 'object' || !('type' in def)) continue
    resolveThunks(name, def)
    registerDef(def as object, domain, name)
    Object.defineProperty(def, 'name', { value: name, enumerable: true, writable: false, configurable: false })
    switch ((def as { type: string }).type) {
      case 'iface':
        ifaces[name] = def as IfaceDef
        break
      case 'node':
        nodes[name] = def as NodeDef
        break
      case 'edge':
        edges[name] = def as EdgeDef
        break
      case 'op':
        throw new SchemaValidationError(
          `Standalone operations are not supported. Define '${name}' as a static method on a node/edge.`,
          `defs.${name}`,
          'a static method on a node/edge',
          'standalone operation',
        )
    }
  }

  const allDefValues = new Set<object>([...Object.values(ifaces), ...Object.values(nodes)])
  return { domain, defs, ifaces, nodes, edges, allDefValues }
}

function resolveThunks(name: string, def: Record<string, any>): void {
  if (typeof def.config === 'function') {
    try {
      def.config = def.config()
    } catch (e) {
      throw new SchemaValidationError(
        `Failed to resolve config thunk for '${name}': ${String(e)}`,
        name,
        'resolvable config thunk',
        'unresolvable',
      )
    }
  }
  const methods = def.config?.methods as Record<string, OpDef> | undefined
  if (methods) {
    for (const [methodName, opDef] of Object.entries(methods)) {
      if (typeof opDef.config.params === 'function') {
        try {
          ;(opDef.config as any).params = (opDef.config.params as () => unknown)()
        } catch (e) {
          throw new SchemaValidationError(
            `Failed to resolve param thunk for '${name}.${methodName}': ${String(e)}`,
            `${name}.${methodName}.params`,
            'resolvable thunk',
            'unresolvable',
          )
        }
      }
    }
  }
}
