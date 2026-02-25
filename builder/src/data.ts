import type {
  Schema,
  NodeDef,
  EdgeDef,
  Ref,
  CoreDef,
  SeedDef,
  CoreInstance,
  CoreLink,
  RefsFromInstances,
  ExtractFullProps,
  ExtractNodeInput,
} from './types.js'
import { getDefName } from './registry.js'

// ── Type-safe input helpers ──────────────────────────────────────────────────
// Guard against infinite recursion when N/E carries `any` config (e.g. NodeDef<any>).
// Also short-circuits for empty configs like nodeDef({}) where there are no props to check.
type IsAny<T> = 0 extends (1 & T) ? true : false

type NodeInputData<N extends NodeDef<any>> =
  N extends NodeDef<infer C>
    ? [IsAny<C>] extends [true]
      ? Record<string, unknown>
      : [keyof C & ('props' | 'data' | 'implements' | 'extends')] extends [never]
        ? Record<string, unknown>
        : Partial<ExtractNodeInput<N>>
    : Record<string, unknown>

type EdgeInputData<E extends EdgeDef> =
  E extends EdgeDef<any, any, infer C>
    ? [IsAny<C>] extends [true]
      ? Record<string, unknown>
      : [keyof C & 'props'] extends [never]
        ? Record<string, unknown>
        : Partial<ExtractFullProps<E>>
    : Record<string, unknown>

// ── Builders ────────────────────────────────────────────────────────────────

export function node<N extends NodeDef<any>>(
  def: N,
  data: NodeInputData<N>,
): CoreInstance<N> {
  return { __kind: 'core-instance', __nodeDef: def, __data: data as Record<string, unknown> }
}

export function edge<E extends EdgeDef>(
  from: CoreInstance | Ref,
  edgeRef: E,
  to: CoreInstance | Ref,
  data?: EdgeInputData<E>,
): CoreLink
export function edge(
  from: CoreInstance | Ref,
  edgeRef: string,
  to: CoreInstance | Ref,
  data?: Record<string, unknown>,
): CoreLink
export function edge(
  from: CoreInstance | Ref,
  edgeRef: string | EdgeDef,
  to: CoreInstance | Ref,
  data?: Record<string, unknown>,
): CoreLink {
  const edgeName = typeof edgeRef === 'string' ? edgeRef : getDefName(edgeRef)
  if (!edgeName)
    throw new Error('Edge ref must be a string or a registered EdgeDef (from defineSchema)')
  return { __kind: 'core-link', __from: from, __to: to, __edge: edgeName, __data: data }
}

// ── Kernel references ───────────────────────────────────────────────────────

export const kernelRefs = {
  root: { __ref: true, __def: null, __id: '__kernel:root' } as Ref,
  system: { __ref: true, __def: null, __id: '__kernel:system' } as Ref,
}

// ── Internal helpers ────────────────────────────────────────────────────────

let refCounter = 0

function resolveTarget(target: CoreInstance | Ref, instanceToRef: Map<CoreInstance, Ref>): Ref {
  if ('__kind' in target) {
    const resolved = instanceToRef.get(target as CoreInstance)
    if (!resolved) throw new Error('CoreInstance not found in this core/seed definition')
    return resolved
  }
  return target as Ref
}

// ── defineCore ──────────────────────────────────────────────────────────────

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

// ── defineSeed ──────────────────────────────────────────────────────────────

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
    const id = `${namespace}:__seed_${++refCounter}`
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
