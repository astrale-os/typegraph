// lower/modifiers.ts
// ============================================================
// Modifier Lowering — CST → AST
//
// Classifies uniform CST Modifier nodes into typed AST variants:
// Flag, Format, Match, In, Length, Indexed, Cardinality, Range, Lifecycle
// ============================================================

import {
  type ModifierListNode,
  type ModifierNode,
  type StringListNode,
  isToken,
  spanOf,
} from '../cst/index'
import {
  type Modifier,
  type FlagModifier,
  type FormatModifier,
  type MatchModifier,
  type InModifier,
  type LengthModifier,
  type IndexedModifier,
  type CardinalityModifier,
  type LifecycleModifier,
} from '../ast/index'
import { type Token, type Span } from '../tokens'
import { type DiagnosticBag, DiagnosticCodes } from '../diagnostics'
import { type LoweringContext } from './index'
import { unquote } from './declarations'

export function lowerModifiers(ctx: LoweringContext, list: ModifierListNode | null): Modifier[] {
  if (!list) return []
  return list.modifiers.map((m) => lowerModifier(ctx, m))
}

/**
 * Classify a CST Modifier into a typed AST variant.
 *
 * CST modifier children patterns:
 *   flag:         [Ident]                              → FlagModifier
 *   format:       [Ident("format"), Colon, Ident]      → FormatModifier
 *   match:        [Ident("match"), Colon, StringLit]   → MatchModifier
 *   in:           [Ident("in"), Colon, StringList]     → InModifier
 *   length:       [Ident("length"), Colon, N, .., M]   → LengthModifier
 *   indexed:      [Ident("indexed"), Colon, Ident]     → IndexedModifier
 *   cardinality:  [Ident, Arrow, N (.. M|*)?]          → CardinalityModifier
 *   range:        [GtEq|LtEq, NumberLit]               → RangeModifier
 *   lifecycle:    [Ident("on_kill_*"), Colon, Ident]   → LifecycleModifier
 */
function lowerModifier(ctx: LoweringContext, mod: ModifierNode): Modifier {
  const tokens = mod.children.filter(isToken)
  const span = spanOf(mod)

  // Empty (shouldn't happen, but be safe)
  if (tokens.length === 0) {
    return { kind: 'FlagModifier', flag: 'unique', span }
  }

  const first = tokens[0]

  // Range modifiers: >= N, <= N
  if (first.kind === 'GtEq' || first.kind === 'LtEq') {
    const value = tokens[1] ? parseNum(tokens[1].text, ctx.diagnostics, tokens[1].span) : 0
    if (first.kind === 'GtEq') {
      return { kind: 'RangeModifier', operator: '>=', min: value, max: null, span }
    } else {
      return { kind: 'RangeModifier', operator: '<=', min: null, max: value, span }
    }
  }

  // Everything else starts with Ident
  const name = first.text

  // Check for Arrow → cardinality
  if (tokens.length >= 3 && tokens[1].kind === 'Arrow') {
    return lowerCardinalityModifier(ctx, tokens, span)
  }

  // Check for Colon → kv modifier
  if (tokens.length >= 2 && tokens[1].kind === 'Colon') {
    return lowerKvModifier(ctx, name, tokens, mod, span)
  }

  // Standalone N..M after an Ident (name + DotDot + Number)
  if (tokens.length >= 3 && tokens[1].kind === 'DotDot') {
    const min = parseNum(first.text, ctx.diagnostics, first.span)
    const max = parseNum(tokens[2].text, ctx.diagnostics, tokens[2].span)
    return { kind: 'RangeModifier', operator: '..', min, max, span }
  }

  // Bare flag
  return lowerFlagModifier(name, span)
}

function lowerFlagModifier(name: string, span: Span): FlagModifier {
  const FLAGS = ['no_self', 'acyclic', 'unique', 'symmetric', 'readonly', 'indexed'] as const
  type FlagName = (typeof FLAGS)[number]
  if (FLAGS.includes(name as FlagName)) {
    return { kind: 'FlagModifier', flag: name as FlagName, span }
  }
  // Unknown flag — still emit, validator will catch it
  // oxlint-disable-next-line no-explicit-any
  return { kind: 'FlagModifier', flag: name as any, span }
}

function lowerCardinalityModifier(
  ctx: LoweringContext,
  tokens: Token[],
  span: Span,
): CardinalityModifier {
  const paramName = tokens[0]
  // tokens: [Ident, Arrow, NumberLit, (DotDot, NumberLit|Star)?]
  const min = parseNum(tokens[2].text, ctx.diagnostics, tokens[2].span)
  let max: number | null = min // default: exact

  if (tokens.length >= 5 && tokens[3].kind === 'DotDot') {
    if (tokens[4].kind === 'Star') {
      max = null // unbounded
    } else {
      max = parseNum(tokens[4].text, ctx.diagnostics, tokens[4].span)
    }
  }

  return {
    kind: 'CardinalityModifier',
    param: { value: paramName.text, span: paramName.span },
    min,
    max,
    span,
  }
}

function lowerKvModifier(
  ctx: LoweringContext,
  name: string,
  tokens: Token[],
  mod: ModifierNode,
  span: Span,
): Modifier {
  switch (name) {
    case 'format':
      return {
        kind: 'FormatModifier',
        format: tokens[2].text,
        span,
      } as FormatModifier

    case 'match':
      return {
        kind: 'MatchModifier',
        pattern: unquote(tokens[2].text),
        span,
      } as MatchModifier

    case 'in': {
      // Find the StringList CST node in children
      const stringListNode = mod.children.find((c) => !isToken(c) && c.kind === 'StringList') as
        | StringListNode
        | undefined
      const values: string[] = []
      if (stringListNode) {
        for (const v of stringListNode.values) {
          values.push(unquote(v.text))
        }
      }
      return { kind: 'InModifier', values, span } as InModifier
    }

    case 'length': {
      // tokens: [Ident("length"), Colon, NumberLit, DotDot, NumberLit]
      const min = tokens[2] ? parseNum(tokens[2].text, ctx.diagnostics, tokens[2].span) : 0
      const max = tokens[4] ? parseNum(tokens[4].text, ctx.diagnostics, tokens[4].span) : min
      return { kind: 'LengthModifier', min, max, span } as LengthModifier
    }

    case 'indexed': {
      const dir = tokens[2].text
      if (dir === 'asc' || dir === 'desc') {
        return { kind: 'IndexedModifier', direction: dir, span } as IndexedModifier
      }
      // Fallback
      return { kind: 'IndexedModifier', direction: 'asc', span } as IndexedModifier
    }

    case 'on_kill_source':
    case 'on_kill_target': {
      const action = tokens[2].text as 'cascade' | 'unlink' | 'prevent'
      return {
        kind: 'LifecycleModifier',
        event: name as 'on_kill_source' | 'on_kill_target',
        action,
        span,
      } as LifecycleModifier
    }

    default:
      // Unknown kv modifier — treat as flag, validator will catch
      return lowerFlagModifier(name, span)
  }
}

// --- Utilities ---

/** Parse a number literal string. */
export function parseNum(s: string, diagnostics: DiagnosticBag, span: Span): number {
  const value = Number(s)
  if (!Number.isFinite(value)) {
    diagnostics.error(span, DiagnosticCodes.L_INVALID_NUMBER, `Invalid number literal '${s}'`)
    return 0
  }
  return value
}
