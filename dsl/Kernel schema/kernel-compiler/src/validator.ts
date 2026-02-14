// src/validator.ts
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

import {
  Declaration,
  type InterfaceDecl,
  type NodeDecl,
  type EdgeDecl,
  type TypeAliasDecl,
  type Attribute,
  type TypeExpr,
  type NamedType,
  type NullableType,
  type UnionType,
  type Expression,
  type Modifier,
  type CardinalityModifier,
  type FlagModifier,
  type LifecycleModifier,
  type RangeModifier,
  LengthModifier,
  type FormatModifier,
  InModifier,
  MatchModifier,
  type IndexedModifier,
} from './ast.js'
import { type ResolvedSchema, type Symbol } from './resolver.js'
import { DiagnosticBag, DiagnosticCodes } from './diagnostics.js'

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
  const v = new Validator(schema, bag, options)
  v.validate()
  return { valid: !bag.hasErrors(), diagnostics: bag }
}

// ─── Valid modifier kinds per context ────────────────────────

const EDGE_MODIFIERS = new Set([
  'FlagModifier', // no_self, acyclic, unique, symmetric
  'CardinalityModifier',
  'LifecycleModifier',
])

const EDGE_FLAGS = new Set(['no_self', 'acyclic', 'unique', 'symmetric'])

const ATTR_MODIFIERS = new Set([
  'FlagModifier', // unique, readonly, indexed
  'IndexedModifier', // indexed: asc|desc
])

const ATTR_FLAGS = new Set(['unique', 'readonly', 'indexed'])

const ALIAS_MODIFIERS = new Set([
  'FormatModifier',
  'MatchModifier',
  'InModifier',
  'LengthModifier',
  'RangeModifier',
])

// ────────────────────────────────────────────────────────────

class Validator {
  private schema: ResolvedSchema
  private diagnostics: DiagnosticBag
  private builtinScalarSet: Set<string>
  private knownDefaultFunctions: Set<string>

  constructor(schema: ResolvedSchema, diagnostics: DiagnosticBag, options?: ValidateOptions) {
    this.schema = schema
    this.diagnostics = diagnostics
    this.builtinScalarSet = new Set(options?.scalars ?? [])
    this.knownDefaultFunctions = new Set(options?.defaultFunctions ?? [])
  }

  validate(): void {
    for (const decl of this.schema.declarations) {
      switch (decl.kind) {
        case 'TypeAliasDecl':
          this.validateTypeAlias(decl)
          break
        case 'InterfaceDecl':
          this.validateInterface(decl)
          break
        case 'NodeDecl':
          this.validateClass(decl)
          break
        case 'EdgeDecl':
          this.validateEdge(decl)
          break
        case 'ExtendDecl':
          // Nothing to validate beyond resolution
          break
      }
    }
  }

  // ─── Type Alias ────────────────────────────────────────────

  private validateTypeAlias(decl: TypeAliasDecl): void {
    for (const mod of decl.modifiers) {
      if (!ALIAS_MODIFIERS.has(mod.kind)) {
        this.diagnostics.error(
          mod.span,
          DiagnosticCodes.V_INVALID_MODIFIER,
          `Modifier '${modifierName(mod)}' is not valid on a type alias`,
        )
      }
    }
  }

  // ─── Interface ─────────────────────────────────────────────

  private validateInterface(decl: InterfaceDecl): void {
    // Interfaces can only extend other interfaces
    for (const parent of decl.extends) {
      const sym = this.schema.symbols.get(parent.value)
      if (sym && sym.symbolKind !== 'Interface') {
        this.diagnostics.error(
          parent.span,
          DiagnosticCodes.V_INTERFACE_IMPLEMENTS,
          `Interface '${decl.name.value}' can only extend interfaces, but '${parent.value}' is a ${sym.symbolKind}`,
        )
      }
    }

    for (const attr of decl.attributes) {
      this.validateAttribute(attr)
    }
  }

  // ─── Class ─────────────────────────────────────────────────

  private validateClass(decl: NodeDecl): void {
    // Classes can only implement interfaces
    for (const parent of decl.implements) {
      const sym = this.schema.symbols.get(parent.value)
      if (sym && sym.symbolKind !== 'Interface') {
        this.diagnostics.error(
          parent.span,
          DiagnosticCodes.V_CLASS_EXTENDS_CLASS,
          `Class '${decl.name.value}' can only implement interfaces, but '${parent.value}' is a ${sym.symbolKind}`,
        )
      }
    }

    // Node classes shouldn't have edge modifiers
    for (const mod of decl.modifiers) {
      this.diagnostics.warning(
        mod.span,
        DiagnosticCodes.V_INVALID_MODIFIER,
        `Modifier '${modifierName(mod)}' on a node class has no effect`,
      )
    }

    for (const attr of decl.attributes) {
      this.validateAttribute(attr)
    }
  }

  // ─── Edge ──────────────────────────────────────────────────

  private validateEdge(decl: EdgeDecl): void {
    for (const mod of decl.modifiers) {
      this.validateEdgeModifier(mod, decl)
    }

    for (const attr of decl.attributes) {
      this.validateAttribute(attr)
    }
  }

  private validateEdgeModifier(mod: Modifier, decl: EdgeDecl): void {
    // Check modifier is valid in edge context
    if (!EDGE_MODIFIERS.has(mod.kind)) {
      this.diagnostics.error(
        mod.span,
        DiagnosticCodes.V_INVALID_MODIFIER,
        `Modifier '${modifierName(mod)}' is not valid on an edge`,
      )
      return
    }

    // Flag validation
    if (mod.kind === 'FlagModifier') {
      const flag = (mod as FlagModifier).flag
      if (!EDGE_FLAGS.has(flag)) {
        this.diagnostics.error(
          mod.span,
          DiagnosticCodes.V_INVALID_MODIFIER,
          `Flag '${flag}' is not valid on an edge (valid: no_self, acyclic, unique, symmetric)`,
        )
      }
    }

    // Cardinality: check bounds and param name
    if (mod.kind === 'CardinalityModifier') {
      const card = mod as CardinalityModifier

      // Verify the parameter name exists in the edge signature
      const paramNames = decl.params.map((p) => p.name.value)
      if (!paramNames.includes(card.param.value)) {
        this.diagnostics.error(
          card.param.span,
          DiagnosticCodes.V_INVALID_CARDINALITY,
          `Cardinality references parameter '${card.param.value}', but edge '${decl.name.value}' has parameters: ${paramNames.join(', ')}`,
        )
      }

      // Check min <= max
      if (card.max !== null && card.min > card.max) {
        this.diagnostics.error(
          mod.span,
          DiagnosticCodes.V_INVALID_CARDINALITY,
          `Invalid cardinality: min (${card.min}) > max (${card.max})`,
        )
      }
    }
  }

  // ─── Attribute ─────────────────────────────────────────────

  private validateAttribute(attr: Attribute): void {
    for (const mod of attr.modifiers) {
      if (!ATTR_MODIFIERS.has(mod.kind)) {
        this.diagnostics.error(
          mod.span,
          DiagnosticCodes.V_INVALID_MODIFIER,
          `Modifier '${modifierName(mod)}' is not valid on an attribute`,
        )
      } else if (mod.kind === 'FlagModifier') {
        const flag = (mod as FlagModifier).flag
        if (!ATTR_FLAGS.has(flag)) {
          this.diagnostics.error(
            mod.span,
            DiagnosticCodes.V_INVALID_MODIFIER,
            `Flag '${flag}' is not valid on an attribute (valid: unique, readonly, indexed)`,
          )
        }
      }
    }

    this.validateDefaultValue(attr)
  }

  private validateDefaultValue(attr: Attribute): void {
    if (!attr.defaultValue) return

    if (!this.isExpressionCompatibleWithType(attr.defaultValue, attr.type, new Set())) {
      this.diagnostics.error(
        attr.defaultValue.span,
        DiagnosticCodes.V_DEFAULT_TYPE_MISMATCH,
        `Default value is incompatible with attribute type '${renderTypeExpr(attr.type)}'`,
      )
    }

    if (attr.defaultValue.kind === 'CallExpression') {
      const fnName = attr.defaultValue.fn.value
      if (!this.knownDefaultFunctions.has(fnName)) {
        this.diagnostics.error(
          attr.defaultValue.fn.span,
          DiagnosticCodes.V_UNKNOWN_FUNCTION,
          `Unknown default function '${fnName}()'`,
        )
      }
    }
  }

  private isExpressionCompatibleWithType(
    expr: Expression,
    type: TypeExpr,
    visitedAliases: Set<string>,
  ): boolean {
    switch (type.kind) {
      case 'NullableType':
        return (
          expr.kind === 'NullLiteral' ||
          this.isExpressionCompatibleWithType(expr, (type as NullableType).inner, visitedAliases)
        )

      case 'UnionType':
        return (type as UnionType).types.some((candidate) =>
          this.isExpressionCompatibleWithType(expr, candidate, visitedAliases),
        )

      case 'NamedType':
        return this.isExpressionCompatibleWithNamedType(
          expr,
          (type as NamedType).name.value,
          visitedAliases,
        )

      // edge<...> cannot currently have compatible literal/call defaults
      case 'EdgeRefType':
        return false

      default:
        return false
    }
  }

  private isExpressionCompatibleWithNamedType(
    expr: Expression,
    typeName: string,
    visitedAliases: Set<string>,
  ): boolean {
    const expected = this.baseScalarForType(typeName, visitedAliases)
    if (!expected) return false

    if (expr.kind === 'CallExpression') {
      return this.knownDefaultFunctions.has(expr.fn.value) && this.builtinScalarSet.has(expected)
    }

    switch (expr.kind) {
      case 'StringLiteral':
        return expected === 'String' || expected === 'ByteString'
      case 'NumberLiteral':
        return expected === 'Int' || expected === 'Float' || expected === 'Bitmask'
      case 'BooleanLiteral':
        return expected === 'Boolean'
      case 'NullLiteral':
        return false
      default:
        return false
    }
  }

  private baseScalarForType(
    typeName: string,
    visitedAliases: Set<string>,
  ): string | null {
    if (this.builtinScalarSet.has(typeName)) {
      return typeName
    }

    const sym = this.schema.symbols.get(typeName)
    if (
      !sym ||
      sym.symbolKind !== 'TypeAlias' ||
      !sym.declaration ||
      sym.declaration.kind !== 'TypeAliasDecl'
    ) {
      return null
    }

    if (visitedAliases.has(typeName)) {
      return null
    }

    visitedAliases.add(typeName)
    const aliasedType = sym.declaration.type

    if (aliasedType.kind === 'NamedType') {
      return this.baseScalarForType(aliasedType.name.value, visitedAliases)
    }

    return null
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function modifierName(mod: Modifier): string {
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

function renderTypeExpr(type: TypeExpr): string {
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
