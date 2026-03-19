import type { Schema } from '../schema/schema.js'
import type { CoreInstance, CoreLink, Ref, CoreDef, RefsFromInstances } from './types.js'

let refCounter = 0

function resolveTarget(target: CoreInstance | Ref, instanceToRef: Map<CoreInstance, Ref>): Ref {
  // oxlint-disable-next-line no-explicit-any
  if ('type' in target && (target as any).type === 'core-instance') {
    const resolved = instanceToRef.get(target as CoreInstance)
    if (!resolved) throw new Error('CoreInstance not found in this core/seed definition')
    return resolved
  }
  return target as Ref
}

export function defineCore<
  S extends Schema,
  const N extends string,
  const Nodes extends Record<string, CoreInstance>,
>(
  schema: S,
  namespace: N,
  config: { nodes: Nodes; links?: readonly CoreLink[] },
): CoreDef<S, N, RefsFromInstances<Nodes>> {
  const operations: Array<{ type: 'create' | 'link'; args: unknown[] }> = []
  const instanceToRef = new Map<CoreInstance, Ref>()

  for (const [, instance] of Object.entries(config.nodes)) {
    const id = `${namespace}:__ref_${++refCounter}`
    const r: Ref = { __ref: true, __def: instance.__nodeDef, __id: id } as Ref
    instanceToRef.set(instance, r)
    operations.push({ type: 'create', args: [instance.__nodeDef, instance.__data, r] })
  }

  if (config.links) {
    for (const lnk of config.links) {
      const from = resolveTarget(lnk.__from, instanceToRef)
      const to = resolveTarget(lnk.__to, instanceToRef)
      operations.push({ type: 'link', args: [from, lnk.__edge, to, lnk.__data] })
    }
  }

  const refs: Record<string, Ref> = {}
  for (const [name, instance] of Object.entries(config.nodes)) {
    refs[name] = instanceToRef.get(instance)!
  }

  return { schema, namespace, refs, __operations: operations } as unknown as CoreDef<
    S,
    N,
    RefsFromInstances<Nodes>
  >
}

export { resolveTarget }
