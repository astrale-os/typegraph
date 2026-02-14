// validator/index.ts
// ============================================================
// Validator — Resolved Schema → Validated Schema + Diagnostics
//
// Checks semantic rules that go beyond name resolution:
//   - Classes only implement interfaces (not other classes)
//   - Interfaces only extend interfaces
//   - Cardinality bounds are coherent (min <= max)
//   - no_self makes sense (endpoints share a type)
//   - Modifier placement is valid (e.g., acyclic on an edge, not a node)
//   - Default values match declared types
//   - No contradictory modifiers
// ============================================================

import { type ResolvedSchema } from '../resolver/index'
import { DiagnosticBag } from '../diagnostics'
import {
  type Modifier,
  type FlagModifier,
  type FormatModifier,
  type IndexedModifier,
  type CardinalityModifier,
  type RangeModifier,
  type LifecycleModifier,
  type TypeExpr,
} from '../ast/index'
import { validateDeclarations } from './declarations'

export interface ValidateOptions {
  /** Known scalar type names for default-value type-checking. */
  scalars?: readonly string[];
  /** Known default-value function names. */
  defaultFunctions?: readonly string[];
}

export interface ValidateResult {
  valid: boolean
  diagnostics: DiagnosticBag
}

export function validate(
  schema: ResolvedSchema,
  diagnostics?: DiagnosticBag,
  options?: ValidateOptions,
): ValidateResult {
  const bag = diagnostics ?? new DiagnosticBag()
  const ctx: ValidatorContext = {
    schema,
    diagnostics: bag,
    builtinScalarSet: new Set(options?.scalars ?? []),
    knownDefaultFunctions: new Set(options?.defaultFunctions ?? []),
  }
  validateDeclarations(ctx)
  return { valid: !bag.hasErrors(), diagnostics: bag }
}

// ─── Shared Context ─────────────────────────────────────────

export interface ValidatorContext {
  readonly schema: ResolvedSchema
  readonly diagnostics: DiagnosticBag
  readonly builtinScalarSet: Set<string>
  readonly knownDefaultFunctions: Set<string>
}

// ─── Valid modifier kinds per context ────────────────────────

export const EDGE_MODIFIERS = new Set([
  'FlagModifier', // no_self, acyclic, unique, symmetric
  'CardinalityModifier',
  'LifecycleModifier',
])

export const EDGE_FLAGS = new Set(['no_self', 'acyclic', 'unique', 'symmetric'])

export const ATTR_MODIFIERS = new Set([
  'FlagModifier', // unique, readonly, indexed
  'IndexedModifier', // indexed: asc|desc
])

export const ATTR_FLAGS = new Set(['unique', 'readonly', 'indexed'])

export const ALIAS_MODIFIERS = new Set([
  'FormatModifier',
  'MatchModifier',
  'InModifier',
  'LengthModifier',
  'RangeModifier',
])

// ─── Helpers ─────────────────────────────────────────────────

export function modifierName(mod: Modifier): string {
  switch (mod.kind) {
    case 'FlagModifier':
      return (mod as FlagModifier).flag
    case 'FormatModifier':
      return `format: ${(mod as FormatModifier).format}`
    case 'MatchModifier':
      return 'match'
    case 'InModifier':
      return 'in'
    case 'LengthModifier':
      return 'length'
    case 'IndexedModifier':
      return `indexed: ${(mod as IndexedModifier).direction}`
    case 'CardinalityModifier':
      return `${(mod as CardinalityModifier).param.value} -> ...`
    case 'RangeModifier':
      return (mod as RangeModifier).operator
    case 'LifecycleModifier':
      return (mod as LifecycleModifier).event
    default:
      return 'unknown'
  }
}

export function renderTypeExpr(type: TypeExpr): string {
  switch (type.kind) {
    case 'NamedType':
      return type.name.value
    case 'NullableType':
      return `${renderTypeExpr(type.inner)}?`
    case 'UnionType':
      return type.types.map((part) => renderTypeExpr(part)).join(' | ')
    case 'EdgeRefType':
      return type.target ? `edge<${type.target.value}>` : 'edge<any>'
    default:
      return '?'
  }
}
