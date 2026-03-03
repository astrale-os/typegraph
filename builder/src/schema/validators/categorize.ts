import type { IfaceDef } from '../../defs/iface.js'
import type { NodeDef } from '../../defs/node.js'
import type { EdgeDef } from '../../defs/edge.js'
import type { AnyDef } from '../../defs/index.js'
import type { OpDef } from '../../defs/op.js'
import { registerDef } from '../../registry.js'
import { SchemaValidationError } from '../schema.js'
import type { SchemaContext } from './context.js'

/** Resolve all thunks (config + param) and partition defs by type. */
export function categorize(domain: string, defs: Record<string, AnyDef>): SchemaContext {
  const ifaces: Record<string, IfaceDef> = {}
  const nodes: Record<string, NodeDef> = {}
  const edges: Record<string, EdgeDef> = {}

  for (const [name, def] of Object.entries(defs)) {
    resolveThunks(name, def)
    registerDef(def, domain, name)
    Object.defineProperty(def, 'name', { value: name, enumerable: true, writable: false, configurable: false })
    switch (def.type) {
      case 'iface':
        ifaces[name] = def
        break
      case 'node':
        nodes[name] = def
        break
      case 'edge':
        edges[name] = def
        break
      default:
        throw new SchemaValidationError(
          `Unsupported def type '${(def as any).type}' for '${name}'. Expected iface, node, or edge.`,
          `defs.${name}`,
          'iface | node | edge',
          (def as any).type,
        )
    }
  }

  const allDefValues = new Set<object>([...Object.values(ifaces), ...Object.values(nodes)])
  return { domain, defs, ifaces, nodes, edges, allDefValues }
}

function resolveThunks(name: string, def: AnyDef): void {
  if (typeof def.config === 'function') {
    try {
      ;(def as any).config = (def.config as () => unknown)()
    } catch (e) {
      throw new SchemaValidationError(
        `Failed to resolve config thunk for '${name}': ${String(e)}`,
        name,
        'resolvable config thunk',
        'unresolvable',
      )
    }
  }
  const methods = def.config.methods as Record<string, OpDef> | undefined
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
