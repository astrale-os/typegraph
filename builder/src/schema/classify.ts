import { isAbstract, isConcrete, type AnyDef } from '../grammar/definition/discriminants.js'
import { SchemaValidationError } from './error.js'

/**
 * Validate that each definition's `__kind` matches its declared group.
 * Abstract defs (node-interface, edge-interface) must be in `interfaces`.
 * Concrete defs (node-class, edge-class) must be in `classes`.
 */
export function classifyDefs(
  interfaces: Record<string, AnyDef>,
  classes: Record<string, AnyDef>,
): void {
  for (const [name, def] of Object.entries(interfaces)) {
    if (!isAbstract(def)) {
      throw new SchemaValidationError(
        `Definition '${name}' in 'interfaces' has kind '${def.__kind}' — expected a node-interface or edge-interface`,
        `interfaces.${name}`,
        'node-interface | edge-interface',
        def.__kind,
      )
    }
  }

  for (const [name, def] of Object.entries(classes)) {
    if (!isConcrete(def)) {
      throw new SchemaValidationError(
        `Definition '${name}' in 'classes' has kind '${def.__kind}' — expected a node-class or edge-class`,
        `classes.${name}`,
        'node-class | edge-class',
        def.__kind,
      )
    }
  }
}
