import type { EdgeDef } from '../defs/edge.js'
import type { CoreInstance, CoreLink, Ref } from './types.js'
import type { EdgeInputData } from './node.js'
import { getDefName } from '../registry.js'

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
  return { type: 'core-link', __from: from, __to: to, __edge: edgeName, __data: data }
}
