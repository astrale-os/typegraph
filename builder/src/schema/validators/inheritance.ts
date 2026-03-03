import type { IfaceDef } from '../../defs/iface.js'
import { hasDefName } from '../../registry.js'
import { SchemaValidationError } from '../schema.js'
import type { SchemaContext } from './context.js'

export function validateInheritance(ctx: SchemaContext): void {
  const isKnownDef = (target: object): boolean => ctx.allDefValues.has(target) || hasDefName(target)

  for (const [name, def] of Object.entries(ctx.ifaces)) {
    const exts = def.config.extends as IfaceDef[] | undefined
    if (exts) {
      for (const parent of exts) {
        if (!isKnownDef(parent)) {
          throw new SchemaValidationError(
            `Interface '${name}' extends an unknown type`,
            `${name}.extends`,
            'a def in this schema or registered in another schema',
            'unknown reference',
          )
        }
      }
    }
  }

  for (const [name, def] of Object.entries(ctx.nodes)) {
    const config = def.config
    if (config.extends && !isKnownDef(config.extends)) {
      throw new SchemaValidationError(
        `Node '${name}' extends an unknown type`,
        `${name}.extends`,
        'a def in this schema or registered in another schema',
        'unknown reference',
      )
    }
    const impls = config.implements as IfaceDef[] | undefined
    if (impls) {
      for (const iface of impls) {
        if (!isKnownDef(iface)) {
          throw new SchemaValidationError(
            `Node '${name}' implements an unknown type`,
            `${name}.implements`,
            'a def in this schema or registered in another schema',
            'unknown reference',
          )
        }
      }
    }
  }
}
