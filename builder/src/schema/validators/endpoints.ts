import type { Cardinality, EndpointConfig } from '../../grammar/facets/endpoints.js'
import type { SchemaContext } from './context.js'

import { isEdge } from '../../grammar/definition/discriminants.js'
import { SchemaValidationError } from '../error.js'
import { isKnownDef } from '../refs.js'

const VALID_CARDINALITIES: readonly Cardinality[] = ['0..1', '1', '0..*', '1..*']

/** Validate endpoint types exist and cardinality values are valid */
export function validateEndpoints(ctx: SchemaContext): void {
  const allDefs = { ...ctx.interfaces, ...ctx.classes }

  for (const [name, def] of Object.entries(allDefs)) {
    if (!isEdge(def)) continue

    const from = def.from as EndpointConfig
    const to = def.to as EndpointConfig

    for (const endpoint of [from, to]) {
      // Rule 6: Endpoint types exist
      for (const type of endpoint.types) {
        if (!isKnownDef(type as object, ctx.identityMap)) {
          throw new SchemaValidationError(
            `Definition '${name}' references an unknown type in endpoint '${endpoint.as}'`,
            `${name}.${endpoint.as}`,
            'a def in this schema or imported',
            'unknown reference',
          )
        }
      }

      // Rule 10: Cardinality valid
      if (
        endpoint.cardinality !== undefined &&
        !VALID_CARDINALITIES.includes(endpoint.cardinality)
      ) {
        throw new SchemaValidationError(
          `Invalid cardinality '${String(endpoint.cardinality)}' on '${name}' endpoint '${endpoint.as}'`,
          `${name}.${endpoint.as}.cardinality`,
          VALID_CARDINALITIES.join(', '),
          String(endpoint.cardinality),
        )
      }
    }
  }
}
