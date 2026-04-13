import type { z } from 'zod'

import type { MethodInheritance } from './inheritance.js'
import type { OutputMode } from './output.js'

/** Shape of the params record on a function config */
export type ParamShape = Record<string, z.ZodType>

/** Function configuration */
export interface FnConfig {
  readonly params?: ParamShape | (() => ParamShape)
  readonly returns: z.ZodType
  readonly inheritance?: MethodInheritance
  readonly output?: OutputMode
  readonly static?: boolean
}
