import type { z } from 'zod'

import type { AttributeDef } from '../grammar/facets/attributes.js'

/** Create an attribute definition with explicit metadata */
export function prop<S extends z.ZodType>(
  schema: S,
  opts?: { private?: boolean },
): AttributeDef<S> {
  return {
    _tag: 'AttributeDef',
    schema,
    private: opts?.private ?? false,
  }
}
