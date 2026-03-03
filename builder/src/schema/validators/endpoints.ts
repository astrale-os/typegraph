import type { EndpointCfg } from '../../defs/edge.js'
import type { Cardinality } from '../../defs/common.js'
import { hasDefName } from '../../registry.js'
import { SchemaValidationError } from '../schema.js'
import type { SchemaContext } from './context.js'

export function validateEndpoints(ctx: SchemaContext): void {
  const isKnownDef = (target: object): boolean => ctx.allDefValues.has(target) || hasDefName(target)
  const validCardinalities: Cardinality[] = ['0..1', '1', '0..*', '1..*']

  for (const [edgeName, edgeDef] of Object.entries(ctx.edges)) {
    for (const endpoint of [edgeDef.from, edgeDef.to] as EndpointCfg[]) {
      for (const type of endpoint.types) {
        if (!isKnownDef(type as object)) {
          throw new SchemaValidationError(
            `Edge '${edgeName}' references an unknown type in endpoint '${endpoint.as}'`,
            `edges.${edgeName}.${endpoint.as}`,
            'a def in this schema',
            'unknown reference',
          )
        }
      }
      if (
        endpoint.cardinality !== undefined &&
        !validCardinalities.includes(endpoint.cardinality)
      ) {
        throw new SchemaValidationError(
          `Invalid cardinality '${String(endpoint.cardinality)}' on edge '${edgeName}' endpoint '${endpoint.as}'`,
          `edges.${edgeName}.${endpoint.as}.cardinality`,
          validCardinalities.join(', '),
          String(endpoint.cardinality),
        )
      }
    }
  }
}
