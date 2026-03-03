import type { Schema } from '../schema/schema.js'
import type { CoreInstance, CoreLink, Ref, CoreDef, RefsFromInstances } from '../core/types.js'
import { resolveTarget } from '../core/define.js'

let seedCounter = 0

export interface SeedDef<
  S extends Schema = Schema,
  C extends CoreDef = CoreDef,
  R extends Record<string, Ref> = Record<string, Ref>,
> {
  readonly schema: S
  readonly core: C
  readonly refs: R
  readonly __operations: ReadonlyArray<{ type: 'create' | 'link'; args: unknown[] }>
}

export function defineSeed<
  S extends Schema,
  C extends CoreDef<S>,
  const Nodes extends Record<string, CoreInstance>,
>(
  schema: S,
  core: C,
  config: { nodes: Nodes; links?: readonly CoreLink[] },
): SeedDef<S, C, RefsFromInstances<Nodes>> {
  const operations: Array<{ type: 'create' | 'link'; args: unknown[] }> = []
  const namespace = core.namespace
  const instanceToRef = new Map<CoreInstance, Ref>()

  for (const [, instance] of Object.entries(config.nodes)) {
    const id = `${namespace}:__seed_${++seedCounter}`
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

  return { schema, core, refs, __operations: operations } as unknown as SeedDef<
    S,
    C,
    RefsFromInstances<Nodes>
  >
}
