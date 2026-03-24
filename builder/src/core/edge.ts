import type { Def } from '../defs/definition.js'
import type { EdgeInputData } from './node.js'
import type { CorePath } from './path.js'
import type { CoreNode, CoreEdge } from './types.js'

import { getDefName } from '../registry.js'

export function edge<E extends Def>(
  from: CoreNode | CorePath,
  edgeRef: E,
  to: CoreNode | CorePath,
  data?: EdgeInputData<E>,
): CoreEdge
export function edge(
  from: CoreNode | CorePath,
  edgeRef: string,
  to: CoreNode | CorePath,
  data?: Record<string, unknown>,
): CoreEdge
export function edge(
  from: CoreNode | CorePath,
  edgeRef: string | Def,
  to: CoreNode | CorePath,
  data?: Record<string, unknown>,
): CoreEdge {
  const edgeName = typeof edgeRef === 'string' ? edgeRef : getDefName(edgeRef)
  if (!edgeName)
    throw new Error('Edge ref must be a string or a registered Def (from defineSchema)')
  return { type: 'core-edge', __from: from, __to: to, __edge: edgeName, __data: data }
}
