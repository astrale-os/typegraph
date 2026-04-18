export { SchemaValidationError } from './error.js'
export type { Schema } from './schema.js'
export { defineSchema } from './define.js'
export { classifyDefs } from './classify.js'
export {
  defRef,
  methodRef,
  buildDescriptorMap,
  buildDefDescriptorMap,
  buildMethodRefs,
  isKnownDef,
  type DefRef,
  type MethodRef,
  type KindSegment,
  type DefDescriptor,
  type InterfaceRefs,
  type ClassRefs,
  type AllDefRefs,
} from './refs.js'
export { resolveAllMethods, resolveAllProperties, resolveAllPropertyKeys } from './resolve/index.js'
export type { SchemaContext } from './validators/context.js'
