import type { GraphModel, TypeRef, ValueConstraints, ValueNode } from '../model'
import { scalarToZod } from './scalars'

export type ZodRefContext = 'param' | 'result'

/**
 * Resolve a TypeRef to its Zod type expression string.
 * Shared across validators and method-ops emitters.
 *
 * @param context  Controls how Node/Edge types are resolved:
 *   - `'param'` (default) — Node/Edge → `z.string()` (caller passes an ID)
 *   - `'result'` — Node → `validators.NodeName` (method returns full object)
 */
export function resolveZodTypeRef(
  model: GraphModel,
  ref: TypeRef,
  context: ZodRefContext = 'param',
): string {
  switch (ref.kind) {
    case 'Scalar':
      return scalarToZod(ref.name)
    case 'Alias': {
      const alias = model.aliases.get(ref.name)
      if (!alias) return 'z.unknown()'
      if (alias.isEnum && alias.enumValues) return `z.enum(${alias.name}Values)`
      return applyConstraints(scalarToZod(alias.underlyingType), alias.constraints)
    }
    case 'Node':
      return context === 'result' ? `validators.${ref.name}` : 'z.string()'
    case 'Edge':
      return 'z.string()'
    case 'ValueType':
      return `validators.${ref.name}`
    case 'TaggedUnion':
      return `validators.${ref.name}`
    case 'AnyEdge':
      return 'z.string()'
    case 'List':
      return `z.array(${resolveZodTypeRef(model, ref.element, context)})`
    case 'Union':
      return `z.union([${ref.types.map((t) => resolveZodTypeRef(model, t, context)).join(', ')}])`
    default:
      return 'z.unknown()'
  }
}

export function applyConstraints(base: string, constraints: ValueConstraints | null): string {
  if (!constraints) return base
  let r = base

  if (constraints.format === 'email') r += '.email()'
  else if (constraints.format === 'url') r += '.url()'
  else if (constraints.format === 'uuid') r += '.uuid()'

  if (constraints.pattern) r += `.regex(/${constraints.pattern}/)`
  if (constraints.length_min !== undefined) r += `.min(${constraints.length_min})`
  if (constraints.length_max !== undefined) r += `.max(${constraints.length_max})`
  if (constraints.value_min !== undefined) r += `.min(${constraints.value_min})`
  if (constraints.value_max !== undefined) r += `.max(${constraints.value_max})`

  return r
}

export function renderDefault(value: ValueNode): string | null {
  switch (value.kind) {
    case 'StringLiteral':
      return `'${value.value}'`
    case 'NumberLiteral':
      return `${value.value}`
    case 'BooleanLiteral':
      return `${value.value}`
    case 'Null':
      return 'null'
    case 'Call':
      return null // function calls can't be static Zod defaults
  }
}
