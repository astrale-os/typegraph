import type { IndexDef } from '../facets/indexes.js'
import type { PropertyShape } from '../facets/properties.js'
import type { FnDef } from '../function/def.js'

/**
 * Common configuration shared by all 4 definition roles.
 * Each role extends this with its specific facets.
 */
export interface DefConfigBase {
  readonly properties?: PropertyShape
  readonly indexes?: readonly IndexDef[]
  readonly methods?: Record<string, FnDef>
}
