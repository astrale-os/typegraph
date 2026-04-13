import type { AnyEdgeDef } from '../../grammar/definition/discriminants.js'
import type { CorePath } from './path.js'
import type { CoreNode, CoreEdge } from './types.js'

/** Create a core edge between nodes or paths */
export function edge(
  from: CoreNode | CorePath,
  edgeDef: AnyEdgeDef,
  to: CoreNode | CorePath,
  data?: Record<string, unknown>,
): CoreEdge {
  return {
    type: 'core-edge',
    __from: from,
    __to: to,
    __edgeDef: edgeDef,
    __data: data,
  }
}
