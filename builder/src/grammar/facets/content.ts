import type { z } from 'zod'

/** Shape of the content record on a node definition config (datastore-backed fields) */
export type ContentShape = Record<string, z.ZodType>
