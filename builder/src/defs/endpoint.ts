/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Def } from './definition.js'

export type Cardinality = '0..1' | '1' | '0..*' | '1..*'

export interface EndpointCfg {
  readonly as: string
  readonly types: readonly Def<any>[]
  readonly cardinality?: Cardinality
}
