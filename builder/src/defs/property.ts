import type { z } from 'zod'

export type Property = z.ZodType
export type PropShape = Record<string, Property>
