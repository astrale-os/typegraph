import type { AnyInterfaceDef, AnyClassDef, AnyDef } from '../grammar/definition/discriminants.js'
import type { Schema } from './schema.js'

import { classifyDefs } from './classify.js'
import { buildDefDescriptorMap, buildMethodRefs } from './refs.js'
import { resolveConfigThunks, resolveParamThunks, resolveSelfReferences } from './resolve/index.js'
import { validateSchema, type SchemaContext } from './validators/index.js'

interface DefineSchemaInput<
  I extends Record<string, AnyInterfaceDef>,
  C extends Record<string, AnyClassDef>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Imports extends readonly Schema<any, any, any>[] = readonly [],
> {
  readonly interfaces: I
  readonly classes: C
  readonly imports?: Imports
}

/**
 * Define a typed property graph schema.
 *
 * @param domain - The domain identifier (e.g., 'my-domain.com')
 * @param input - The schema definition with interfaces and classes groups
 * @returns A fully validated and resolved Schema object
 */
export function defineSchema<
  const I extends Record<string, AnyInterfaceDef>,
  const C extends Record<string, AnyClassDef>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Imports extends readonly Schema<any, any, any>[] = readonly [],
>(domain: string, input: DefineSchemaInput<I, C, Imports>): Schema<I, C, Imports> {
  const interfaces = input.interfaces
  const classes = input.classes
  const imports = (input.imports ?? []) as Imports

  // Phase 1: Resolve thunks and self-references
  const allDefs: Record<string, AnyDef> = { ...interfaces, ...classes }
  for (const [name, def] of Object.entries(allDefs)) {
    resolveConfigThunks(name, def)
    resolveParamThunks(name, def)
    resolveSelfReferences(def)
  }

  // Phase 2: Classify — validate __kind matches group
  classifyDefs(interfaces, classes)

  // Phase 3: Build identity map for validation lookups
  const schema: Schema<I, C, Imports> = {
    domain,
    interfaces,
    classes,
    functions: {},
    imports,
  }
  const descriptorMap = buildDefDescriptorMap(schema)

  // Phase 4: Validate
  const ctx: SchemaContext = { domain, interfaces, classes, imports, descriptorMap }
  validateSchema(ctx)

  // Phase 5: Build method refs
  const fns = buildMethodRefs(schema)

  return {
    domain,
    interfaces,
    classes,
    functions: fns,
    imports,
  }
}
