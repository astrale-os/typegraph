// validator/defaults.ts
// ============================================================
// Attribute & Default Value Validation
//
// Validates attribute modifiers and checks that default values
// are type-compatible with their declared types.
// ============================================================

import {
  type Attribute,
  type TypeExpr,
  type NamedType,
  type NullableType,
  type UnionType,
  type Expression,
  type FlagModifier,
} from '../ast/index.js'
import { DiagnosticCodes } from '../diagnostics.js'
import {
  type ValidatorContext,
  ATTR_MODIFIERS,
  ATTR_FLAGS,
  modifierName,
  renderTypeExpr,
} from './index.js'

// ─── Attribute ─────────────────────────────────────────────

export function validateAttribute(ctx: ValidatorContext, attr: Attribute): void {
  for (const mod of attr.modifiers) {
    if (!ATTR_MODIFIERS.has(mod.kind)) {
      ctx.diagnostics.error(
        mod.span,
        DiagnosticCodes.V_INVALID_MODIFIER,
        `Modifier '${modifierName(mod)}' is not valid on an attribute`,
      )
    } else if (mod.kind === 'FlagModifier') {
      const flag = (mod as FlagModifier).flag
      if (!ATTR_FLAGS.has(flag)) {
        ctx.diagnostics.error(
          mod.span,
          DiagnosticCodes.V_INVALID_MODIFIER,
          `Flag '${flag}' is not valid on an attribute (valid: unique, readonly, indexed)`,
        )
      }
    }
  }

  validateDefaultValue(ctx, attr)
}

function validateDefaultValue(ctx: ValidatorContext, attr: Attribute): void {
  if (!attr.defaultValue) return

  if (!isExpressionCompatibleWithType(ctx, attr.defaultValue, attr.type, new Set())) {
    ctx.diagnostics.error(
      attr.defaultValue.span,
      DiagnosticCodes.V_DEFAULT_TYPE_MISMATCH,
      `Default value is incompatible with attribute type '${renderTypeExpr(attr.type)}'`,
    )
  }

  if (attr.defaultValue.kind === 'CallExpression') {
    const fnName = attr.defaultValue.fn.value
    if (!ctx.knownDefaultFunctions.has(fnName)) {
      ctx.diagnostics.error(
        attr.defaultValue.fn.span,
        DiagnosticCodes.V_UNKNOWN_FUNCTION,
        `Unknown default function '${fnName}()'`,
      )
    }
  }
}

function isExpressionCompatibleWithType(
  ctx: ValidatorContext,
  expr: Expression,
  type: TypeExpr,
  visitedAliases: Set<string>,
): boolean {
  switch (type.kind) {
    case 'NullableType':
      return (
        expr.kind === 'NullLiteral' ||
        isExpressionCompatibleWithType(ctx, expr, (type as NullableType).inner, visitedAliases)
      )

    case 'UnionType':
      return (type as UnionType).types.some((candidate) =>
        isExpressionCompatibleWithType(ctx, expr, candidate, visitedAliases),
      )

    case 'NamedType':
      return isExpressionCompatibleWithNamedType(
        ctx,
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

function isExpressionCompatibleWithNamedType(
  ctx: ValidatorContext,
  expr: Expression,
  typeName: string,
  visitedAliases: Set<string>,
): boolean {
  const expected = baseScalarForType(ctx, typeName, visitedAliases)
  if (!expected) return false

  if (expr.kind === 'CallExpression') {
    return ctx.knownDefaultFunctions.has(expr.fn.value) && ctx.builtinScalarSet.has(expected)
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

function baseScalarForType(
  ctx: ValidatorContext,
  typeName: string,
  visitedAliases: Set<string>,
): string | null {
  if (ctx.builtinScalarSet.has(typeName)) {
    return typeName
  }

  const sym = ctx.schema.symbols.get(typeName)
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
    return baseScalarForType(ctx, aliasedType.name.value, visitedAliases)
  }

  return null
}
