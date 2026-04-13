import type { z } from 'zod'

import type { PropertyDef } from '../grammar/facets/properties.js'

/** Create a property definition with explicit metadata */
export function prop<S extends z.ZodType>(schema: S, opts?: { private?: boolean }): PropertyDef<S> {
  return {
    _tag: 'PropertyDef',
    schema,
    private: opts?.private ?? false,
  }
}
