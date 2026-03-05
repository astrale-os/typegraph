import type { EndpointCfg } from '../../defs/def.js'
import type { Cardinality } from '../../defs/common.js'
import { hasDefName } from '../../registry.js'
import { SchemaValidationError } from '../schema.js'
import type { SchemaContext } from './context.js'

export function validateEndpoints(ctx: SchemaContext): void {
  const isKnownDef = (target: object): boolean => ctx.allDefValues.has(target) || hasDefName(target)
  const validCardinalities: Cardinality[] = ['0..1', '1', '0..*', '1..*']

  for (const [name, def] of Object.entries(ctx.defs)) {
    const endpoints = def.config.endpoints as [EndpointCfg, EndpointCfg] | undefined
    if (!endpoints) continue
    for (const endpoint of endpoints) {
      for (const type of endpoint.types) {
        if (!isKnownDef(type as object)) {
          throw new SchemaValidationError(
            `Definition '${name}' references an unknown type in endpoint '${endpoint.as}'`,
            `defs.${name}.${endpoint.as}`,
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
          `Invalid cardinality '${String(endpoint.cardinality)}' on '${name}' endpoint '${endpoint.as}'`,
          `defs.${name}.${endpoint.as}.cardinality`,
          validCardinalities.join(', '),
          String(endpoint.cardinality),
        )
      }
    }
  }
}
