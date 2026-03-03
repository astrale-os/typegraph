import type { z } from 'zod'

export type PropShape = Record<string, z.ZodType>
export type DataShape = Record<string, z.ZodType>
export type ParamShape = Record<string, z.ZodType>

export type IndexDef = string | { property: string; type?: 'btree' | 'fulltext' | 'unique' }

export type Cardinality = '0..1' | '1' | '0..*' | '1..*'
export type Access = 'private' | 'internal'

export type DefType = 'iface' | 'node' | 'edge' | 'op'
